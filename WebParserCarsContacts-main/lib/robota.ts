import crypto from "node:crypto";
import type { Contact } from "./types";

const SITE_BASE = "https://robota.ua";
const API_BASES = ["https://api.robota.ua", "https://api.rabota.ua"];

const API_HEADERS: Record<string, string> = {
  accept: "application/json, text/plain, */*",
  "accept-language": "uk-UA,uk;q=0.9,en;q=0.8",
  origin: SITE_BASE,
  referer: `${SITE_BASE}/`,
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
};

type JsonRecord = Record<string, unknown>;

type SearchDocument = {
  id?: number | string;
  notebookId?: number | string;
  companyId?: number | string;
};

type SearchApiResponse = {
  documents?: SearchDocument[];
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function firstString(data: JsonRecord, keys: string[]): string {
  for (const key of keys) {
    const value = clean(data[key]);
    if (value) return value;
  }
  return "";
}

function collectStrings(value: unknown, depth = 0): string[] {
  if (depth > 4 || value == null) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap((item) => collectStrings(item, depth + 1));

  const record = asRecord(value);
  if (!record) return [];

  return Object.values(record).flatMap((item) => collectStrings(item, depth + 1));
}

function htmlToText(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizePhone(raw: string): string {
  let digits = (raw || "").replace(/\D/g, "");
  if (!digits) return "";

  if (digits.length === 10 && digits.startsWith("0")) {
    digits = `38${digits}`;
  }

  if (digits.length === 11 && digits.startsWith("80")) {
    digits = `3${digits}`;
  }

  if (digits.length === 12 && digits.startsWith("380")) {
    return `+${digits}`;
  }

  return raw.trim();
}

function phoneCandidates(text: string) {
  const re = /(?:\+?38[\s().-]*)?0\d{2}[\s().-]*\d{3}[\s.-]*\d{2}[\s.-]*\d{2}/g;
  return [...text.matchAll(re)].map((match) => ({
    raw: match[0],
    index: match.index ?? 0
  }));
}

function scorePhone(text: string, index: number): number {
  const area = text
    .slice(Math.max(0, index - 120), Math.min(text.length, index + 150))
    .toLowerCase();

  let score = 0;
  if (/контакт|телефон|тел\.|дзвон|phone|mobile/.test(area)) score += 6;
  if (/telegram|viber|whatsapp|вайбер|телеграм|вотсап|ватсап/.test(area)) score += 3;
  if (/зарплат|грн|₴/.test(area)) score -= 2;
  return score;
}

function normalizeHandle(value: string): string {
  const normalized = clean(value).replace(
    /^https?:\/\/(?:t\.me|telegram\.me)\//i,
    "@"
  );

  if (!normalized) return "";
  return normalized.startsWith("@") ? normalized : `@${normalized}`;
}

function makeId(primaryKey: string): string {
  const hash = crypto
    .createHash("sha1")
    .update(primaryKey.toLowerCase())
    .digest("hex")
    .slice(0, 8)
    .toUpperCase();

  return `EMP-${hash}`;
}

function primaryKey(data: Omit<Contact, "id">): string {
  return (
    data.phone ||
    data.telegram.toLowerCase() ||
    data.email.toLowerCase() ||
    `${data.company.toLowerCase()}|${data.fullName.toLowerCase()}` ||
    data.sourceUrl
  );
}

function vacancyIdFromUrl(url: string): string {
  const match = url.match(/vacancy(\d+)/i);
  return match?.[1] || "";
}

function companyIdFromUrl(url: string): string {
  const match = url.match(/company(\d+)/i);
  return match?.[1] || "0";
}

async function fetchJsonFromApi<T>(pathAndQuery: string, timeoutMs = 15000): Promise<T> {
  let lastError: unknown = null;

  for (const base of API_BASES) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${base}${pathAndQuery}`, {
        method: "GET",
        headers: API_HEADERS,
        redirect: "follow",
        cache: "no-store",
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`API HTTP ${response.status}`);
      }

      const text = await response.text();
      if (!text.trim()) throw new Error("API повернув порожню відповідь");

      try {
        return JSON.parse(text) as T;
      } catch {
        throw new Error("API повернув не JSON");
      }
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Не вдалося звернутися до API robota.ua");
}

function extractTelegram(text: string): string {
  const link = text.match(/(?:https?:\/\/)?(?:t\.me|telegram\.me)\/([A-Za-z0-9_]{5,32})/i);
  if (link?.[1]) return normalizeHandle(link[1]);

  const contextual = text.match(
    /(?:telegram|телеграм)[^@\n]{0,40}(@[A-Za-z0-9_]{5,32})/i
  );
  if (contextual?.[1]) return contextual[1];

  const generic = text.match(/(?:^|[\s(\[])(@[A-Za-z][A-Za-z0-9_]{4,31})\b/);
  return generic?.[1] || "";
}

function channelNumber(text: string, channel: "viber" | "whatsapp"): string {
  const channelRegex =
    channel === "viber"
      ? /viber|вайбер/i
      : /whatsapp|ватсап|вотсап/i;

  for (const candidate of phoneCandidates(text)) {
    const area = text.slice(
      Math.max(0, candidate.index - 90),
      Math.min(text.length, candidate.index + 110)
    );

    if (channelRegex.test(area)) {
      return normalizePhone(candidate.raw);
    }
  }

  return "";
}

function contactNameFromText(text: string): string {
  const patterns = [
    /Контактна\s+особа\s*[-—:]?\s*([^|]{2,80}?)(?=\s+(?:тел\.?|телефон|показати\s+контакти|\+?38|0\d{2})|$)/iu,
    /Контакт(?:на\s+особа)?\s*[-—:]?\s*([А-ЯІЇЄҐA-Z][А-ЯІЇЄҐа-яіїєґA-Za-z'’\-]+(?:\s+[А-ЯІЇЄҐA-Z][А-ЯІЇЄҐа-яіїєґA-Za-z'’\-]+){0,2})/u
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return clean(match[1]).replace(/\s+Показати.*$/iu, "");
    }
  }

  return "";
}

function parseVacancyApi(data: JsonRecord, sourceUrl: string, sourceKeyword: string): Contact | null {
  const company = firstString(data, [
    "companyName",
    "company",
    "employerName",
    "notebookName"
  ]);

  const descriptionRaw = firstString(data, [
    "description",
    "fullDescription",
    "shortDescription",
    "vacancyDescription"
  ]);

  const explicitContactText = collectStrings({
    contact: data.contact,
    contacts: data.contacts,
    contactInfo: data.contactInfo,
    contactPerson: data.contactPerson,
    contactName: data.contactName,
    contactPhone: data.contactPhone,
    phone: data.phone,
    email: data.email,
    telegram: data.telegram,
    viber: data.viber,
    whatsapp: data.whatsapp
  }).join(" ");

  const description = htmlToText(descriptionRaw);
  const allText = clean(`${explicitContactText} ${description}`);

  const explicitFullName = firstString(data, [
    "contactName",
    "contactPerson",
    "managerName",
    "responsiblePerson"
  ]);
  const fullName = explicitFullName || contactNameFromText(allText);

  const explicitPhone = firstString(data, [
    "contactPhone",
    "phone",
    "phoneNumber",
    "mobilePhone"
  ]);

  const phones = phoneCandidates(allText)
    .map((candidate) => ({
      ...candidate,
      score: scorePhone(allText, candidate.index)
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const phone = explicitPhone
    ? normalizePhone(explicitPhone)
    : phones.length
      ? normalizePhone(phones[0].raw)
      : "";

  const explicitTelegram = firstString(data, ["telegram", "telegramUser", "telegramName"]);
  const telegram = explicitTelegram
    ? normalizeHandle(explicitTelegram)
    : extractTelegram(allText);

  const explicitEmail = firstString(data, ["contactEmail", "email", "emailAddress"]);
  const emailMatch = allText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const email = (explicitEmail || emailMatch?.[0] || "").toLowerCase();

  const explicitViber = firstString(data, ["viber", "viberPhone"]);
  const explicitWhatsapp = firstString(data, ["whatsapp", "whatsApp", "whatsappPhone"]);

  const viber = explicitViber
    ? normalizePhone(explicitViber)
    : channelNumber(allText, "viber");

  const whatsapp = explicitWhatsapp
    ? normalizePhone(explicitWhatsapp)
    : channelNumber(allText, "whatsapp");

  if (!phone && !telegram && !viber && !whatsapp && !email && !fullName) {
    return null;
  }

  const base: Omit<Contact, "id"> = {
    company,
    fullName,
    phone,
    telegram,
    viber,
    whatsapp,
    email,
    sourceUrl,
    sourceKeyword,
    createdAt: new Date().toISOString()
  };

  return {
    id: makeId(primaryKey(base)),
    ...base
  };
}

export async function searchKeyword(keyword: string): Promise<string[]> {
  const normalizedKeyword = clean(keyword);
  if (!normalizedKeyword) return [];

  const params = new URLSearchParams({
    keyWords: normalizedKeyword,
    count: "40",
    page: "0",
    sortBy: "Date"
  });

  const data = await fetchJsonFromApi<SearchApiResponse>(
    `/vacancy/search?${params.toString()}`
  );

  const documents = Array.isArray(data.documents) ? data.documents : [];
  const urls = new Set<string>();

  for (const document of documents) {
    const vacancyId = String(document.id ?? "").trim();
    const companyId = String(document.notebookId ?? document.companyId ?? "0").trim();

    if (!/^\d+$/.test(vacancyId)) continue;

    urls.add(`${SITE_BASE}/company${/^\d+$/.test(companyId) ? companyId : "0"}/vacancy${vacancyId}`);
  }

  return [...urls];
}

export async function fetchAndParseVacancy(
  url: string,
  keyword: string
): Promise<Contact | null> {
  const vacancyId = vacancyIdFromUrl(url);
  if (!vacancyId) throw new Error("Не вдалося визначити ID вакансії");

  const data = await fetchJsonFromApi<unknown>(
    `/vacancy?id=${encodeURIComponent(vacancyId)}`
  );

  const record = asRecord(data);
  if (!record) throw new Error("Некоректна відповідь API вакансії");

  const companyId = String(
    record.notebookId ?? record.companyId ?? companyIdFromUrl(url) ?? "0"
  );

  const canonicalUrl = `${SITE_BASE}/company${/^\d+$/.test(companyId) ? companyId : "0"}/vacancy${vacancyId}`;

  return parseVacancyApi(record, canonicalUrl, keyword);
}
