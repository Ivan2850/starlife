"use client";

import { useEffect, useMemo, useState } from "react";
import type { Contact, SearchResponse } from "@/lib/types";

const STORAGE_KEY = "robota-public-contacts-v1";
const DUPLICATES_KEY = "robota-public-contacts-duplicates-v1";

const PRESETS = [
  "водій",
  "водій категорії B",
  "водій категорії C",
  "водій категорії CE",
  "водій-експедитор",
  "далекобійник",
  "водій міжнародник",
  "водій з власним авто",
  "перевізник"
];

const DEFAULT_KEYWORDS = PRESETS.join("\n");

function normalizePhone(raw: string) {
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("0")) digits = `38${digits}`;
  if (digits.length === 12 && digits.startsWith("380")) return `+${digits}`;
  return raw.trim();
}

function keyOf(c: Contact) {
  const phone = normalizePhone(c.phone);
  const telegram = c.telegram.trim().toLowerCase();
  const email = c.email.trim().toLowerCase();
  const companyName = `${c.company.trim().toLowerCase()}|${c.fullName.trim().toLowerCase()}`;

  if (phone) return phone;
  if (telegram) return telegram;
  if (email) return email;
  if (c.company.trim() || c.fullName.trim()) return companyName;
  return c.sourceUrl;
}

function mergeContacts(oldList: Contact[], incoming: Contact[]) {
  const map = new Map<string, Contact>();

  for (const c of [...oldList, ...incoming]) {
    const key = keyOf(c);
    if (!key) continue;

    const old = map.get(key);
    if (!old) {
      map.set(key, c);
      continue;
    }

    map.set(key, {
      ...old,
      company: old.company || c.company,
      fullName: old.fullName || c.fullName,
      phone: old.phone || c.phone,
      telegram: old.telegram || c.telegram,
      viber: old.viber || c.viber,
      whatsapp: old.whatsapp || c.whatsapp,
      email: old.email || c.email,
      sourceUrl: old.sourceUrl || c.sourceUrl,
      sourceKeyword: old.sourceKeyword || c.sourceKeyword
    });
  }

  return [...map.values()];
}

function escapeCsv(v: string) {
  const safe = String(v ?? "").replace(/\r?\n/g, " ");
  return /[;"\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function fileStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function TruckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10 17h4V5H2v12h3" />
      <path d="M14 9h4l4 4v4h-3" />
      <circle cx="7.5" cy="17.5" r="2.5" />
      <circle cx="16.5" cy="17.5" r="2.5" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6" />
      <path d="M8 13h8M8 17h8" />
    </svg>
  );
}

function TableIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M3 15h18M9 3v18" />
    </svg>
  );
}

function ActivityIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 12h4l2-8 4 16 2-8h6" />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20.6 13.4 11 3.8A2 2 0 0 0 9.6 3H4a1 1 0 0 0-1 1v5.6A2 2 0 0 0 3.8 11l9.6 9.6a2 2 0 0 0 2.8 0l4.4-4.4a2 2 0 0 0 0-2.8Z" />
      <circle cx="7.5" cy="7.5" r="1.5" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M15 3h6v6M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 11v6M14 11v6" />
    </svg>
  );
}

export default function Home() {
  const [keywords, setKeywords] = useState(DEFAULT_KEYWORDS);
  const [limit, setLimit] = useState(20);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [duplicateCounter, setDuplicateCounter] = useState(0);
  const [loading, setLoading] = useState(false);
  const [activePreset, setActivePreset] = useState("");
  const [message, setMessage] = useState("Готово до пошуку.");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [lastStats, setLastStats] = useState({ parsed: 0, found: 0, added: 0 });

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setContacts(JSON.parse(saved));

      const savedDuplicates = localStorage.getItem(DUPLICATES_KEY);
      if (savedDuplicates) setDuplicateCounter(Number(savedDuplicates) || 0);
    } catch {
      setMessage("Не вдалося прочитати локальне сховище браузера.");
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(contacts));
    } catch {
      // localStorage can be unavailable in strict/private browser modes.
    }
  }, [contacts]);

  useEffect(() => {
    try {
      localStorage.setItem(DUPLICATES_KEY, String(duplicateCounter));
    } catch {
      // localStorage can be unavailable in strict/private browser modes.
    }
  }, [duplicateCounter]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return contacts;

    return contacts.filter((c) =>
      [c.company, c.fullName, c.phone, c.telegram, c.viber, c.whatsapp, c.email, c.sourceKeyword]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [contacts, filter]);

  const phoneCount = useMemo(() => contacts.filter((c) => Boolean(c.phone)).length, [contacts]);
  const messengerCount = useMemo(
    () => contacts.filter((c) => Boolean(c.telegram || c.viber || c.whatsapp)).length,
    [contacts]
  );

  async function runSearch(overrideKeywords?: string[], presetLabel = "") {
    const list = overrideKeywords ?? keywords.split(/\n|,/).map((x) => x.trim()).filter(Boolean);

    if (!list.length) {
      setMessage("Додайте хоча б одне ключове слово.");
      return;
    }

    setLoading(true);
    setActivePreset(presetLabel);
    setWarnings([]);
    setMessage(
      presetLabel
        ? `Шукаю контакти за категорією «${presetLabel}»…`
        : "Шукаю публічні вакансії та контакти…"
    );

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords: list, limit })
      });

      const data = (await res.json()) as SearchResponse & { error?: string };
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Пошук завершився помилкою.");
      }

      const before = contacts.length;
      const merged = mergeContacts(contacts, data.contacts);
      const added = Math.max(0, merged.length - before);
      const rejectedAsDuplicates = Math.max(0, data.contacts.length - added);

      setContacts(merged);
      setDuplicateCounter((value) => value + rejectedAsDuplicates);
      setWarnings(data.warnings || []);
      setLastStats({ parsed: data.stats.parsedVacancies, found: data.stats.contactsFound, added });
      setMessage(
        `Перевірено вакансій: ${data.stats.parsedVacancies}. Знайдено контактів: ${data.stats.contactsFound}. Нових у базі: ${added}.`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Помилка пошуку.");
    } finally {
      setLoading(false);
      setActivePreset("");
    }
  }

  function runPreset(preset: string) {
    setKeywords(preset);
    void runSearch([preset], preset);
  }

  function removeContact(id: string) {
    setContacts((list) => list.filter((x) => x.id !== id));
  }

  function clearAll() {
    if (!confirm("Очистити всі локально збережені контакти на цьому пристрої?")) return;
    setContacts([]);
    setDuplicateCounter(0);
    setLastStats({ parsed: 0, found: 0, added: 0 });
    setWarnings([]);
    setMessage("Локальну базу очищено.");
  }

  function resetKeywords() {
    setKeywords(DEFAULT_KEYWORDS);
  }

  function exportCsv() {
    if (!contacts.length) return;

    const header = ["ID", "Компанія", "ПІБ", "Телефон", "Telegram", "Viber", "WhatsApp", "Email"];
    const rows = contacts.map((c) => [c.id, c.company, c.fullName, c.phone, c.telegram, c.viber, c.whatsapp, c.email]);
    const body = [header, ...rows].map((r) => r.map(escapeCsv).join(";")).join("\r\n");
    const blob = new Blob(["\uFEFF" + body], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `driver-contacts-${fileStamp()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function exportXlsx() {
    if (!contacts.length) return;

    const XLSX = await import("xlsx");
    const rows = contacts.map((c) => ({
      ID: c.id,
      Компанія: c.company,
      ПІБ: c.fullName,
      Телефон: c.phone,
      Telegram: c.telegram,
      Viber: c.viber,
      WhatsApp: c.whatsapp,
      Email: c.email
    }));

    const ws = XLSX.utils.json_to_sheet(rows, {
      header: ["ID", "Компанія", "ПІБ", "Телефон", "Telegram", "Viber", "WhatsApp", "Email"]
    });
    ws["!cols"] = [
      { wch: 14 },
      { wch: 28 },
      { wch: 24 },
      { wch: 18 },
      { wch: 20 },
      { wch: 18 },
      { wch: 18 },
      { wch: 30 }
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Контакти");
    XLSX.writeFile(wb, `driver-contacts-${fileStamp()}.xlsx`);
  }

  return (
    <>
      <header className="app-header">
        <div className="header-inner">
          <div className="brand-block">
            <div className="brand-icon"><TruckIcon /></div>
            <div>
              <h1>Driver Contacts Hub</h1>
              <p>Автоматичний збір публічних контактів</p>
            </div>
          </div>

          <div className="header-actions">
            <button className="export-btn export-secondary" onClick={exportCsv} disabled={!contacts.length}>
              <FileIcon />
              <span>CSV</span>
            </button>
            <button className="export-btn export-primary" onClick={exportXlsx} disabled={!contacts.length}>
              <TableIcon />
              <span>Експорт XLSX</span>
            </button>
          </div>
        </div>
      </header>

      <main className="app-main">
        <section className="presets-card">
          <div className="section-caption-row">
            <div className="section-caption"><TagIcon /> Шаблони пошуку (категорії)</div>
            <span>Натисніть категорію — пошук запуститься тут, без переходу на robota.ua</span>
          </div>

          <div className="preset-list">
            {PRESETS.map((preset) => (
              <button
                key={preset}
                className={`preset-chip ${activePreset === preset ? "active" : ""}`}
                onClick={() => runPreset(preset)}
                disabled={loading}
              >
                <SearchIcon />
                <span>{activePreset === preset ? "Пошук…" : preset}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="workspace-grid">
          <div className="search-card">
            <div className="search-card-top">
              <div>
                <h2><SearchIcon /> Пошук вакансій та контактів</h2>
                <p>
                  Введіть свої ключові слова або використайте шаблони вище. Кожен рядок — окремий пошуковий запит.
                </p>
              </div>
              <button className="text-action" onClick={resetKeywords} disabled={loading}>Відновити шаблони</button>
            </div>

            <textarea
              className="keywords-input"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              rows={7}
              placeholder={"водій\nводій категорії B\nводій-експедитор"}
            />

            <div className="search-controls">
              <div className="limit-field">
                <label htmlFor="limit">Максимум вакансій за один запуск</label>
                <select id="limit" value={limit} onChange={(e) => setLimit(Number(e.target.value))} disabled={loading}>
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={30}>30</option>
                  <option value={40}>40</option>
                </select>
              </div>

              <button className="search-button" onClick={() => void runSearch()} disabled={loading}>
                <SearchIcon />
                {loading ? "Шукаю контакти…" : "Знайти контакти"}
              </button>
            </div>

            <div className="safety-note">
              Застосунок використовує лише доступні публічні дані вакансій. Без CAPTCHA, авторизації, обходу антибот-захисту чи відкриття прихованих контактів.
            </div>
          </div>

          <aside className="stats-card">
            <h2><ActivityIcon /> Статистика</h2>

            <div className="stats-main-grid">
              <div className="stat-tile">
                <span>Всього контактів</span>
                <strong>{contacts.length}</strong>
              </div>
              <div className="stat-tile duplicate">
                <span>Відсіяно дублів</span>
                <strong>{duplicateCounter}</strong>
              </div>
            </div>

            <div className="stats-list">
              <div><span>З номерами телефонів</span><strong>{phoneCount}</strong></div>
              <div><span>З Telegram / Viber / WA</span><strong>{messengerCount}</strong></div>
              <div><span>Перевірено останнім запуском</span><strong>{lastStats.parsed}</strong></div>
              <div><span>Нових останнім запуском</span><strong>{lastStats.added}</strong></div>
            </div>

            <button className="clear-all" onClick={clearAll} disabled={!contacts.length}>
              Очистити всі збережені контакти
            </button>
          </aside>
        </section>

        <section className="status-strip">
          <div className="status-text">{message}</div>
          <div className="mini-stats">
            <span>Знайдено останнім запуском: <strong>{lastStats.found}</strong></span>
          </div>
        </section>

        {warnings.length > 0 && (
          <details className="warnings">
            <summary>Є попередження ({warnings.length})</summary>
            <ul>{warnings.map((w, i) => <li key={`${w}-${i}`}>{w}</li>)}</ul>
          </details>
        )}

        <section className="contacts-card">
          <div className="contacts-head">
            <div>
              <h2>База зібраних контактів</h2>
              <p>Дані зберігаються локально в пам’яті браузера цього пристрою.</p>
            </div>

            <div className="filter-box">
              <SearchIcon />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Пошук по базі…"
              />
            </div>
          </div>

          {visible.length > 0 ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Компанія</th>
                    <th>Контактна особа</th>
                    <th>Телефон</th>
                    <th>Telegram</th>
                    <th>Viber</th>
                    <th>WhatsApp</th>
                    <th>Email</th>
                    <th>Дії</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((c) => (
                    <tr key={c.id}>
                      <td data-label="Компанія">
                        <strong>{c.company || "—"}</strong>
                        {c.sourceKeyword && <span className="source-keyword">{c.sourceKeyword}</span>}
                      </td>
                      <td data-label="Контактна особа">{c.fullName || "—"}</td>
                      <td data-label="Телефон">
                        {c.phone ? <a className="contact-link" href={`tel:${c.phone}`}>{c.phone}</a> : "—"}
                      </td>
                      <td data-label="Telegram">
                        {c.telegram ? (
                          <a
                            className="contact-badge telegram"
                            href={`https://t.me/${c.telegram.replace(/^@/, "")}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {c.telegram}
                          </a>
                        ) : "—"}
                      </td>
                      <td data-label="Viber">
                        {c.viber ? <span className="contact-badge viber">{c.viber}</span> : "—"}
                      </td>
                      <td data-label="WhatsApp">
                        {c.whatsapp ? <span className="contact-badge whatsapp">{c.whatsapp}</span> : "—"}
                      </td>
                      <td data-label="Email">
                        {c.email ? <a className="mail-link" href={`mailto:${c.email}`}>{c.email}</a> : "—"}
                      </td>
                      <td className="row-actions" data-label="Дії">
                        {c.sourceUrl && (
                          <a href={c.sourceUrl} target="_blank" rel="noreferrer" title="Відкрити джерело вакансії">
                            <ExternalIcon />
                          </a>
                        )}
                        <button onClick={() => removeContact(c.id)} title="Видалити контакт">
                          <TrashIcon />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-icon"><SearchIcon /></div>
              <h3>{contacts.length ? "За цим фільтром нічого не знайдено" : "Контактів ще немає"}</h3>
              <p>
                {contacts.length
                  ? "Змініть текст у полі пошуку по базі."
                  : "Натисніть одну з категорій вище або введіть власні ключові слова та запустіть пошук."}
              </p>
            </div>
          )}
        </section>
      </main>

      <footer className="app-footer">
        Driver Contacts Hub · Публічні контакти вакансій · Client-side storage · Vercel Ready
      </footer>
    </>
  );
}
