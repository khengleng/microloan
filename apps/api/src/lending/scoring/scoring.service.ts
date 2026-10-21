import { BadRequestException, Injectable } from '@nestjs/common';
import { lending } from '@microloan/shared';
import type { Prisma } from '@microloan/db';
import type { Tx } from '../common/lending-prisma';
import { BusinessDateService } from '../common/business-date.service';
import { D, decStr } from '../common/util';
import {
  FeatureStoreService,
  type FeatureSnapshot,
} from './feature-store.service';
import {
  ScorecardsService,
  type EffectiveScorecard,
} from './scorecards.service';

type Json = Prisma.InputJsonValue;

export type ScoreStage = 'APPLICATION' | 'APPROVAL' | 'RESCORE';

export interface ScoredApplication {
  id: string;
  tenantId: string;
  borrowerId: string;
  productId: string;
  productVersionId: string;
  requestedAmount: unknown;
  currency: string;
  terms: unknown;
}

export interface ScoreOutcome {
  evaluationId: string;
  scorecard: { code: string; version: number; source: 'TENANT' | 'TEMPLATE' };
  thinFile: boolean;
  result: lending.ScorecardResult;
  strategy: lending.StrategyResult;
  explanation: ReturnType<typeof lending.publicScoreExplanation>;
  /** The challenger's evaluation id, if one ran (never part of the decision). */
  challengerEvaluationId: string | null;
}

/**
 * Scores an application (DECISIONS D-075…D-077): picks the champion (or the
 * thin-file scorecard for a thin-file borrower), assembles the inputs,
 * evaluates and applies the product's strategy, then stores the evaluation —
 * and, when the product names one, a challenger evaluated on the same
 * inputs, stored as a shadow that never feeds back into the decision.
 */
@Injectable()
export class ScoringService {
  constructor(
    private readonly scorecards: ScorecardsService,
    private readonly features: FeatureStoreService,
    private readonly businessDate: BusinessDateService,
  ) {}

  async score(
    tx: Tx,
    input: {
      app: ScoredApplication;
      config: lending.ProductConfig;
      stage: ScoreStage;
      actorId: string;
      metrics: Record<string, string | number | null>;
      monthlyPayment: string;
    },
  ): Promise<ScoreOutcome> {
    const { app, config } = input;
    const scoring = config.scoring;
    const tenantId = app.tenantId;
    const resolve = async (code: string) => {
      const e = await this.scorecards.effective(tx, tenantId, code);
      if (!e)
        throw new BadRequestException({
          message: `Scorecard ${code} named by this product is neither a template nor one of this organisation's scorecards.`,
          code: 'SCORECARD_NOT_FOUND',
        });
      return e;
    };
    const champion = await resolve(scoring.championCode);
    const thinCard = scoring.thinFile.enabled
      ? await resolve(scoring.thinFile.scorecardCode)
      : null;
    const challenger = scoring.challengerCode
      ? await resolve(scoring.challengerCode)
      : null;
    const variables = new Set(['bureauScore', 'internalHistoryMonths']);
    for (const c of [champion, thinCard, challenger])
      if (c)
        lending
          .scorecardVariables(c.definition)
          .forEach((v) => variables.add(v));

    const snapshot = await this.features.assemble(tx, {
      tenantId,
      borrowerId: app.borrowerId,
      applicationId: app.id,
      currency: app.currency,
      asOf: await this.businessDate.get(tenantId, tx),
      metrics: input.metrics,
      monthlyPayment: input.monthlyPayment,
      variables: [...variables],
      actorId: input.actorId,
    });
    const inputs = FeatureStoreService.inputs(snapshot);
    const thin = lending.isThinFile(scoring.thinFile, inputs);
    const driving = thin && thinCard ? thinCard : champion;

    const run = (card: EffectiveScorecard) => {
      const result = lending.evaluateScorecard(card.definition, inputs);
      const strategy = lending.evaluateStrategy(scoring.strategy, {
        score: result.score,
        grade: result.grade,
        inputs,
        requestedAmount: decStr(app.requestedAmount as string),
        minCreditScore: config.eligibility.minCreditScore,
      });
      return { result, strategy };
    };
    const main = run(driving);
    const explanation = lending.publicScoreExplanation(
      main.strategy.outcome,
      main.result.adverseReasons,
      main.strategy.knockouts,
    );
    const row = await this.persist(tx, {
      ...input,
      role: 'CHAMPION',
      card: driving,
      thin,
      snapshot,
      ...main,
      explanation,
    });
    let challengerEvaluationId: string | null = null;
    if (challenger && challenger.code !== driving.code) {
      const shadow = run(challenger);
      challengerEvaluationId = (
        await this.persist(tx, {
          ...input,
          role: 'CHALLENGER',
          card: challenger,
          thin,
          snapshot,
          ...shadow,
          explanation: lending.publicScoreExplanation(
            shadow.strategy.outcome,
            shadow.result.adverseReasons,
            shadow.strategy.knockouts,
          ),
        })
      ).id;
    }
    return {
      evaluationId: row.id,
      scorecard: {
        code: driving.code,
        version: driving.version,
        source: driving.source,
      },
      thinFile: thin,
      result: main.result,
      strategy: main.strategy,
      explanation,
      challengerEvaluationId,
    };
  }

  /**
   * The checks a score adds to an approval: the minimum score (the original
   * message), a strategy decline, the grade's maximum amount and, when the
   * strategy enforces it, the grade's risk pricing.
   */
  static approvalBlocking(
    s: ScoreOutcome,
    config: lending.ProductConfig,
    terms: lending.NegotiatedTerms,
  ): { code: string; message: string }[] {
    const out: { code: string; message: string }[] = [];
    const min = config.eligibility.minCreditScore;
    const score = s.result.score;
    if (min !== null && score < min)
      out.push({
        code: 'CREDIT_SCORE',
        message: `Credit score ${score} (grade ${s.result.grade}) is below the minimum ${min}.`,
      });
    else if (s.strategy.outcome === 'DECLINE')
      out.push({
        code: 'SCORE_STRATEGY',
        message: `The ${s.scorecard.code} scorecard strategy declines: ${s.strategy.reasons.map((r) => r.message).join(' ')}`,
      });
    if (s.strategy.amountAboveGradeLimit)
      out.push({
        code: 'GRADE_LIMIT',
        message: `Grade ${s.result.grade} allows at most ${s.strategy.maxAmount} on this product.`,
      });
    const fixed = config.pricing.fixed;
    if (
      config.scoring.strategy.enforceRateAddOn &&
      s.strategy.rateAddOnBps > 0 &&
      fixed
    ) {
      const required = D(fixed.defaultAnnualRate).plus(
        D(s.strategy.rateAddOnBps).div(10_000),
      );
      const rate = D(terms.annualRate ?? fixed.defaultAnnualRate);
      if (rate.lt(required))
        out.push({
          code: 'RISK_PRICING',
          message: `Grade ${s.result.grade} is priced at least ${required.toString()} (default rate plus ${s.strategy.rateAddOnBps} bp); the terms say ${rate.toString()}.`,
        });
    }
    return out;
  }

  private persist(
    tx: Tx,
    x: {
      app: ScoredApplication;
      stage: ScoreStage;
      actorId: string;
      role: 'CHAMPION' | 'CHALLENGER';
      card: EffectiveScorecard;
      thin: boolean;
      snapshot: FeatureSnapshot;
      result: lending.ScorecardResult;
      strategy: lending.StrategyResult;
      explanation: ReturnType<typeof lending.publicScoreExplanation>;
    },
  ) {
    return tx.scoreEvaluation.create({
      data: {
        tenantId: x.app.tenantId,
        applicationId: x.app.id,
        borrowerId: x.app.borrowerId,
        productId: x.app.productId,
        productVersionId: x.app.productVersionId,
        role: x.role,
        stage: x.stage,
        scorecardCode: x.card.code,
        scorecardVersionId: x.card.versionId,
        version: x.card.version,
        source: x.card.source,
        definitionHash: x.card.definitionHash,
        thinFile: x.thin,
        inputs: x.snapshot as unknown as Json,
        result: x.result as unknown as Json,
        score: x.result.score,
        grade: x.result.grade,
        outcome: x.strategy.outcome,
        strategy: {
          ...x.strategy,
          explanation: x.explanation,
        } as unknown as Json,
        drivesDecision: x.role === 'CHAMPION',
        currency: x.app.currency,
        requestedAmount: decStr(x.app.requestedAmount as string),
        engineVersion: lending.LENDING_ENGINE_VERSION,
        evaluatedBy: x.actorId,
      },
    });
  }
}
