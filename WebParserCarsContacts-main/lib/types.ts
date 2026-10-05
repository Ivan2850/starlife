export type Contact = {
  id: string;
  company: string;
  fullName: string;
  phone: string;
  telegram: string;
  viber: string;
  whatsapp: string;
  email: string;
  sourceUrl: string;
  sourceKeyword?: string;
  createdAt?: string;
};

export type SearchResponse = {
  ok: boolean;
  contacts: Contact[];
  stats: {
    keywords: number;
    vacancyUrls: number;
    parsedVacancies: number;
    contactsFound: number;
  };
  warnings: string[];
};
