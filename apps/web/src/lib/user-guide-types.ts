/** Shapes of the generated user-guide modules (scripts/generate-user-guide.mjs). */
export interface GuideHeading {
    id: string;
    text: string;
    depth: number;
}

export interface GuideChapter {
    slug: string;
    /** The number at the start of the file name, if any ("06"). */
    number: string | null;
    title: string;
    group: string;
    summary: string;
    /** Level-2 and level-3 headings, for the table of contents. */
    headings: GuideHeading[];
}

export interface GuideGroup {
    title: string;
    slugs: string[];
}

export interface GuideSection {
    /** Chapter slug; '' is the contents page. */
    slug: string;
    /** Heading anchor; '' is the top of the page. */
    id: string;
    title: string;
    text: string;
}
