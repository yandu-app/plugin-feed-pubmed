import type {
  Plugin,
  FeedAdapter,
  ConfigSchema,
  FetchOptions,
  FetchResult,
  FeedEntry,
  FormatCapability,
  PaperExternalIds,
} from '@yandu/types';

class PubMedAdapter implements FeedAdapter {
  id = 'gov.pubmed';
  name = 'PubMed';

  availableFormats: FormatCapability[] = [
    { format: 'text/html', priority: 1, fetchRequired: true, extension: 'html' },
  ];

  configSchema: ConfigSchema = {
    id: 'adapter.pubmed',
    sections: [
      {
        id: 'general',
        fields: [
          {
            key: 'query',
            type: 'text',
            defaultValue: '',
            validation: { required: true },
          },
          {
            key: 'since',
            type: 'date',
            defaultValue: '',
          },
        ],
      },
    ],
  };

  async fetch(options: FetchOptions): Promise<FetchResult> {
    const { query } = options.config as { query: string };
    const limit = Math.min(options.limit ?? 50, 100);
    const retstart = parseInt(options.cursor ?? '0', 10);

    const searchParams = new URLSearchParams({
      db: 'pubmed',
      term: query,
      retmax: String(limit),
      retstart: String(retstart),
      sort: 'date',
      retmode: 'json',
    });

    if (options.since) {
      const ymd = options.since.toISOString().slice(0, 10).replace(/-/g, '/');
      searchParams.set('term', `${query} AND ${ymd}:3000[PDAT]`);
    }

    const searchRes = await fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${searchParams}`, {
      headers: { 'User-Agent': 'Yandu/1.0' },
    });

    if (!searchRes.ok) {
      throw new Error(`PubMed API error: ${searchRes.status}`);
    }

    const searchData = await searchRes.json() as {
      esearchresult?: { idlist?: string[]; count?: string };
    };
    const pmids = searchData.esearchresult?.idlist ?? [];

    if (pmids.length === 0) {
      return { entries: [], nextCursor: null, hasMore: false };
    }

    const summaryParams = new URLSearchParams({
      db: 'pubmed',
      id: pmids.join(','),
      retmode: 'json',
    });

    const summaryRes = await fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?${summaryParams}`, {
      headers: { 'User-Agent': 'Yandu/1.0' },
    });

    if (!summaryRes.ok) {
      throw new Error(`PubMed API error: ${summaryRes.status}`);
    }

    const summaryData = await summaryRes.json() as {
      result?: Record<string, unknown>;
    };
    const result = summaryData.result ?? {};
    const uids = (result.uids as string[]) ?? [];

    const entries: FeedEntry[] = [];
    for (const pmid of uids) {
      const item = result[pmid] as {
        title?: string;
        sorttitle?: string;
        authors?: Array<{ name: string }>;
        pubdate?: string;
        source?: string;
        articleids?: Array<{ idtype: string; value: string }>;
      } | undefined;
      if (!item) continue;

      const title = item.title || item.sorttitle || 'Untitled';
      const doi = item.articleids?.find((a) => a.idtype === 'doi')?.value;
      const pubDate = item.pubdate ? this.parsePubDate(item.pubdate) : new Date();

      const extIds: Record<string, string> = { pmid };
      if (doi) extIds.doi = doi;

      entries.push({
        id: pmid,
        externalIds: extIds,
        title,
        abstract: '',
        authors: (item.authors ?? []).map((a) => a.name),
        publishedAt: pubDate,
        availableFormats: ['text/html'],
        sourceUrl: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
        metadata: {
          journal: item.source,
        },
      });
    }

    const totalCount = parseInt(searchData.esearchresult?.count ?? '0', 10);
    const nextStart = retstart + pmids.length;

    return {
      entries,
      nextCursor: nextStart < totalCount ? String(nextStart) : null,
      hasMore: nextStart < totalCount,
    };
  }

  private parsePubDate(pubdate: string): Date {
    const yearMatch = pubdate.match(/(\d{4})/);
    if (!yearMatch) return new Date();
    const year = parseInt(yearMatch[1], 10);
    const monthMatch = pubdate.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i);
    const month = monthMatch ? this.monthToNumber(monthMatch[1]) : 0;
    const dayMatch = pubdate.match(/(\d{1,2})\s*$/);
    const day = dayMatch ? parseInt(dayMatch[1], 10) : 1;
    return new Date(year, month, day);
  }

  private monthToNumber(month: string): number {
    const map: Record<string, number> = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    };
    return map[month.toLowerCase()] ?? 0;
  }

  resolveDownload(externalIds: PaperExternalIds): { url: string; format: string; priority: number } | null {
    const pmid = externalIds.pmid;
    if (!pmid) return null;
    return {
      url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      format: 'text/html',
      priority: 2,
    };
  }

  async fetchFormat(entryId: string, format: string): Promise<Blob> {
    if (format !== 'text/html') {
      throw new Error(`Unsupported format: ${format}`);
    }
    const response = await fetch(`https://pubmed.ncbi.nlm.nih.gov/${entryId}/`, {
      headers: { 'User-Agent': 'Yandu/1.0' },
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch HTML: ${response.status}`);
    }
    return response.blob();
  }
}

export default {
  name: '@yandu/plugin-feed-pubmed',
  version: '1.0.0',
  register(system) {
    const adapter = new PubMedAdapter();
    system.capabilities.register(
      { type: 'feed', id: adapter.id, name: adapter.name },
      adapter
    );
  },
} satisfies Plugin;
