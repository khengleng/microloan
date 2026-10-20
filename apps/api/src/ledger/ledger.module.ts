import { Module } from '@nestjs/common';
import { LedgerService } from './ledger.service';

/**
 * The shared chart of accounts and the original module's journal writer.
 * The original journal's screens and read API are gone (D-153); its balances
 * are read by the combined trial balance and the regulatory return, and the
 * loan-book migration still posts the clearing entry that closes a legacy loan.
 */
@Module({
    providers: [LedgerService],
    exports: [LedgerService],
})
export class LedgerModule { }
