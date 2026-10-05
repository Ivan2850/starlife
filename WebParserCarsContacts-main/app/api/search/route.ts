import { NextResponse } from "next/server";
import { fetchAndParseVacancy, searchKeyword } from "@/lib/robota";
import type { Contact, SearchResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type SearchRequestBody = {
  keywords?: unknown;
  limit?: unknown;
};

type SearchBatch = {
  keyword: string;
  urls: string[];
};

function uniqueKey(c: Contact): string {
  return (
    c.phone ||
    c.telegram.toLowerCase() ||
    c.email.toLowerCase() ||
    `${c.company.toLowerCase()}|${c.fullName.toLowerCase()}` ||
    c.sourceUrl
  );
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;

  async function worker(): Promise<void> {
    while (true) {
      const current = index++;
      if (current >= items.length) return;

      const item = items[current];
      if (item === undefined) continue;

      results[current] = await fn(item);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );

  return results;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SearchRequestBody;

    const rawKeywords: unknown[] = Array.isArray(body.keywords)
      ? body.keywords
      : [];

    const keywords: string[] = rawKeywords
      .map((value: unknown) => String(value).trim())
      .filter((value: string) => value.length > 0)
      .slice(0, 20);

    const requestedLimit = Number(body.limit);
    const limit = Math.min(
      Math.max(
        Number.isFinite(requestedLimit) && requestedLimit > 0
          ? requestedLimit
          : 20,
        5
      ),
      40
    );

    if (keywords.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Додайте хоча б одне ключове слово." },
        { status: 400 }
      );
    }

    const warnings: string[] = [];
    const vacancyKeyword = new Map<string, string>();

    const batches: SearchBatch[] = await mapLimit<string, SearchBatch>(
      keywords,
      3,
      async (keyword: string): Promise<SearchBatch> => {
        try {
          const urls = await searchKeyword(keyword);
          return { keyword, urls };
        } catch (error) {
          warnings.push(
            `${keyword}: API пошуку недоступне (${
              error instanceof Error ? error.message : "помилка"
            }).`
          );

          return { keyword, urls: [] };
        }
      }
    );

    for (const batch of batches) {
      for (const url of batch.urls) {
        if (!vacancyKeyword.has(url)) {
          vacancyKeyword.set(url, batch.keyword);
        }
      }
    }

    const targets: Array<[string, string]> = Array.from(
      vacancyKeyword.entries()
    ).slice(0, limit);

    let parsedVacancies = 0;

    const parsed = await mapLimit<[string, string], Contact | null>(
      targets,
      4,
      async ([url, keyword]): Promise<Contact | null> => {
        try {
          const contact = await fetchAndParseVacancy(url, keyword);
          parsedVacancies++;
          return contact;
        } catch (error) {
          warnings.push(
            `Не вдалося прочитати ${url}: ${
              error instanceof Error ? error.message : "помилка"
            }.`
          );
          return null;
        }
      }
    );

    const deduped = new Map<string, Contact>();

    for (const contact of parsed) {
      if (!contact) continue;

      const key = uniqueKey(contact);
      if (!key) continue;

      const current = deduped.get(key);

      if (!current) {
        deduped.set(key, contact);
        continue;
      }

      deduped.set(key, {
        ...current,
        company: current.company || contact.company,
        fullName: current.fullName || contact.fullName,
        phone: current.phone || contact.phone,
        telegram: current.telegram || contact.telegram,
        viber: current.viber || contact.viber,
        whatsapp: current.whatsapp || contact.whatsapp,
        email: current.email || contact.email
      });
    }

    const response: SearchResponse = {
      ok: true,
      contacts: Array.from(deduped.values()),
      stats: {
        keywords: keywords.length,
        vacancyUrls: vacancyKeyword.size,
        parsedVacancies,
        contactsFound: deduped.size
      },
      warnings: warnings.slice(0, 12)
    };

    return NextResponse.json(response, {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Невідома помилка"
      },
      { status: 500 }
    );
  }
}
