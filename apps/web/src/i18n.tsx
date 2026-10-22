import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

export type Language = 'en' | 'hu';

const LANGUAGE_STORAGE_KEY = 'home-memory-language';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

const english: Record<string, string> = {
  Fontos: 'Important',
  Alacsony: 'Low',
  Normál: 'Normal',
  'A TE SZEMÉLYES ASSZISZTENSED': 'YOUR PERSONAL ASSISTANT',
  'Emlékszem, ami fontos.': 'I remember what matters.',
  'A kérdésedre válaszolok, figyelembe véve azokat az emlékeket, amelyek tényleg segítenek.':
    'I answer your questions with the memories that can actually help.',
  'A TE ADATAID, A TE DÖNTÉSED': 'YOUR DATA, YOUR CHOICE',
  'Amit érdemes észben tartani.': 'What is worth remembering.',
  'Nézd át, pontosítsd vagy felejtsd el a személyes emlékeidet, amikor csak szeretnéd.':
    'Review, edit, or forget your personal memories whenever you like.',
  'MINDEN FELETT TE RENDELKEZEL': 'YOU ARE IN CONTROL',
  'A saját tárhelyeden.': 'On your own storage.',
  'Az emlékeid az otthoni szerveren maradnak. Te döntöd el, hová küldesz belőlük a válaszaidhoz.':
    'Your memories stay on your home server. You choose where to send them to get answers.',
  'Nem sikerült betölteni az alkalmazást.': 'The app could not be loaded.',
  'Nem sikerült betölteni az emlékeket.': 'Memories could not be loaded.',
  'Az emlékeid közben megváltoztak, ezért új beszélgetési előzménnyel folytatom.':
    'Your memories changed, so I will continue with a fresh conversation.',
  'A beszélgetés lejárt. Küldd el újra az üzeneted, és új előzményt kezdek.':
    'This conversation has expired. Send your message again to start a new one.',
  'A válasz most nem érhető el.': 'The response is unavailable right now.',
  memorySaved: 'Saved the memory in “{category}”.',
  memoryUpdated: 'Updated the memory in “{category}”.',
  memoryDeleted: 'Deleted the memory from your memory store.',
  'Nem sikerült ellenőrizni a kiválasztott emléket. Töltsd újra a listát.':
    'Could not verify the selected memory. Refresh the list and try again.',
  conversationResetNotice: '{message} The previous conversation history was cleared.',
  'A javaslatot nem sikerült végrehajtani.': 'The proposal could not be applied.',
  'Az adatok frissítése nem sikerült.': 'The data could not be refreshed.',
  'Fő navigáció': 'Main navigation',
  'Home Memory Agent, kezdőlap': 'Home Memory Agent home',
  MUNKATERÜLET: 'WORKSPACE',
  Beszélgetés: 'Chat',
  Emlékeim: 'My memories',
  Beállítások: 'Settings',
  'Csak a tiéd.': 'Yours alone.',
  'Az emlékeid a saját tárhelyeden maradnak.': 'Your memories stay on your own storage.',
  Otthon: 'Home',
  'Asszisztens csatlakoztatva': 'Assistant connected',
  'Az asszisztens szünetel': 'Assistant is paused',
  'Adatok frissítése': 'Refresh data',
  'Hiba bezárása': 'Dismiss error',
  'Értesítés bezárása': 'Dismiss notification',
  'A TE PRIVÁT TÁRAD': 'YOUR PRIVATE MEMORY STORE',
  Memóriák: 'Memories',
  Bezárás: 'Close',
  'Új emlék': 'New memory',
  'Keresés az emlékek között': 'Search memories',
  'Keresés az emlékek között...': 'Search your memories...',
  Memórianézet: 'Memory view',
  Aktív: 'Active',
  Archivált: 'Archived',
  Lejárt: 'Expired',
  Mind: 'All',
  Lejár: 'Expires',
  'Lejárati dátum (nem kötelező)': 'Expiration date (optional)',
  'Emlék archiválása': 'Archive memory',
  'Emlék visszaállítása': 'Restore memory',
  memoryArchived: 'Archived the memory.',
  memoryRestored: 'Restored the memory.',
  TALÁLAT: 'RESULTS',
  'ELMENTETT EMLÉK': 'SAVED MEMORIES',
  'SZERKESZTÉS ÉS TÖRLÉS': 'EDIT AND DELETE',
  'Betöltés…': 'Loading…',
  'Nem találtam egyező emléket.': 'No matching memories found.',
  'Itt kezdődnek a jó beszélgetések.': 'Good conversations start here.',
  'Próbálj másik keresőkifejezést, vagy ellenőrizd a kategóriákat.':
    'Try another search term or check the categories.',
  'Adj hozzá egy emléket, és az asszisztensed máris személyre szabottabb választ adhat.':
    'Add a memory to help your assistant give more personal answers.',
  'Első emlék hozzáadása': 'Add your first memory',
  'Minden emléked ezen a szerveren marad.': 'All your memories stay on this server.',
  'Az emlékeid a tiéid.': 'Your memories belong to you.',
  'Önálló, helyi és a tiéd.': 'Independent, local, and yours.',
  'Beszélgetés az asszisztenssel': 'Chat with your assistant',
  'HOGYAN SEGÍTHETEK?': 'HOW CAN I HELP?',
  'Ismerlek. Már amennyire': 'I know you, as much as',
  'az emlékeid engedik.': 'your memories allow.',
  'Kérdezz nyugodtan, vagy mondd el, mire emlékezzek. Egy jó beszélgetés néha csak egy apró emléken múlik.':
    'Ask me anything, or tell me what to remember. Sometimes one small memory makes a conversation much better.',
  'Az asszisztens beállításra vár': 'Your assistant needs setup',
  'Add meg az LLM-szolgáltató adatait a .env fájlban.':
    'Add your language model provider settings to the .env file.',
  'Mit vigyek magammal?': 'What should I pack?',
  'Mire emlékszel rólam?': 'What do you remember about me?',
  'Jegyezd meg ezt': 'Remember this',
  Te: 'You',
  '1 emléket vettem figyelembe': 'Used 1 memory',
  usedMemories: 'Used {count} memories',
  toolsUsed: 'Used tools: {tools}',
  'weather.getForecast': 'Weather forecast',
  'calendar.getEvents': 'Calendar events',
  'notes.search': 'Search memories',
  'Engedélyezett eszközműveletek': 'Agent tool permissions',
  'Az eszközök külön-külön kapcsolhatók be az AGENT_TOOLS beállítással.':
    'Each operation can be enabled separately with AGENT_TOOLS.',
  Bekapcsolva: 'Enabled',
  Kikapcsolva: 'Disabled',
  'Naptári események a helyi data/calendar.ics fájlból olvasódnak.':
    'Calendar events are read from the local data/calendar.ics file.',
  'Az eszközök találatai bekerülnek a beállított chatmodell kérésébe.':
    'Tool results are included in requests to the configured chat model.',
  'A megadott helyet az Open-Meteo kapja meg.':
    'The location you provide is sent to Open-Meteo.',
  'A chathez nincs beállítva nyelvi modell. A memóriáid továbbra is kezelhetők.':
    'No language model is configured for chat. You can still manage your memories.',
  'Üzenet az asszisztensnek': 'Message your assistant',
  'Írj egy üzenetet…': 'Write a message…',
  'Először állíts be egy nyelvi modellt a .env fájlban…':
    'Set up a language model in the .env file first…',
  'Kérés megszakítása': 'Cancel request',
  'Üzenet küldése': 'Send message',
  'Enter küldés · Shift + Enter új sor': 'Enter to send · Shift + Enter for a new line',
  'Új emlék javaslat': 'New memory suggestion',
  'Módosítási javaslat': 'Edit suggestion',
  'Törlési javaslat': 'Deletion suggestion',
  'Automatikus emlékötlet': 'Automatic memory suggestion',
  'A kérésed alapján': 'Based on your request',
  ' · ellenőrizd jóváhagyás előtt.': ' · review before approving.',
  'A TE DÖNTÉSED': 'YOUR DECISION',
  'EZ AZ EMLÉK TÖRLŐDNE': 'THIS MEMORY WILL BE DELETED',
  MOST: 'CURRENT',
  'JAVASOLT SZÖVEG': 'SUGGESTED TEXT',
  'ELMENTENDŐ SZÖVEG': 'TEXT TO SAVE',
  Kategória: 'Category',
  'Javasolt emlék': 'Suggested memory',
  Prioritás: 'Priority',
  Mégse: 'Cancel',
  'Módosítás alkalmazása': 'Apply changes',
  'A javaslat mentése sikerült.': 'The suggestion was saved.',
  'A javaslatot elutasítottad.': 'You dismissed the suggestion.',
  'Javaslat szerkesztése': 'Edit suggestion',
  Elutasítás: 'Dismiss',
  'Mentés…': 'Saving…',
  Jóváhagyom: 'Approve',
  'A mentés nem sikerült.': 'Could not save.',
  'Egy új, fontos emlék': 'A new, important memory',
  'Röviden írd le úgy, hogy később is érthető legyen.':
    'Describe it briefly so it will still make sense later.',
  'Például: Utazás, Otthon…': 'For example: Travel, Home…',
  'Mi legyen az emlék?': 'What should I remember?',
  'Például: Csendes, természetközeli szállásokat keresek, ha kirándulni megyek.':
    'For example: I prefer quiet places close to nature when I go hiking.',
  'Emlék mentése': 'Save memory',
  'Módosítás mentése': 'Save changes',
  'Az emlék szövege': 'Memory text',
  Módosítva: 'Updated',
  'Biztosan törlöd ezt az emléket? A törlés végleges.':
    'Are you sure you want to delete this memory? This cannot be undone.',
  'Törlés…': 'Deleting…',
  'Igen, törlöm': 'Yes, delete it',
  memoryEditLabel: 'Edit memory: {category}',
  memoryDeleteLabel: 'Delete memory: {category}',
  'Adatvédelmi és modellbeállítások': 'Privacy and model settings',
  SZOLGÁLTATÓ: 'PROVIDER',
  'A beszélgetésed modellje.': 'Your chat model.',
  CSATLAKOZTATVA: 'CONNECTED',
  'BEÁLLÍTÁSRA VÁR': 'SETUP REQUIRED',
  'Ellenőrzés…': 'Checking…',
  'Nincs beállítva': 'Not configured',
  'A memória kezeléséhez nem kell modellt beállítani.':
    'You do not need a model to manage your memories.',
  'Szemantikus keresés beállítva': 'Semantic search configured',
  'Szemantikus keresés nincs beállítva': 'Semantic search not configured',
  'Ollama vagy OpenAI-kompatibilis embedding szolgáltató állítható be.':
    'Configure an Ollama or OpenAI-compatible embedding provider to enable it.',
  'SQLite-adatbázisban, saját tárhelyen': 'In a SQLite database on your own storage',
  'Az adatok helyben maradnak, kivéve ha külső szolgáltatót állítasz be.':
    'Data stays in your local store unless you configure an external provider.',
  'A keresőkifejezést és a mentett emlékek szövegét a beállított embedding-végpontnak küldi el a szemantikus indexeléshez.':
    'Search queries and saved memory text are sent to the configured embedding endpoint for semantic indexing.',
  'A beszélgetés és a kiválasztott emlékek a beállított Ollama-végpontnak is elküldhetők. A keresőkifejezést és a mentett emlékek szövegét a beállított embedding-végpontnak küldi el a szemantikus indexeléshez.':
    'Your chat and selected memories may be sent to the configured Ollama endpoint. Search queries and saved memory text are also sent to the configured embedding endpoint for semantic indexing.',
  'A beszélgetés és a kiválasztott emlékek a beállított külső LLM-szolgáltatóhoz kerülnek. A keresőkifejezést és a mentett emlékek szövegét a beállított embedding-végpontnak küldi el a szemantikus indexeléshez.':
    'Your chat and selected memories are sent to the configured external LLM provider. Search queries and saved memory text are also sent to the configured embedding endpoint for semantic indexing.',
  'Beállítások frissítése': 'Refresh settings',
  'Nyisd meg a .env fájlt': 'Open the .env file',
  'A projekt gyökérmappájában találod.': 'You will find it in the project root folder.',
  'Indítsd újra az alkalmazást': 'Restart the application',
  ' – a kulcs csak a szerveren tárolódik.': ' — the key is stored on the server only.',
  ADATVÉDELEM: 'PRIVACY',
  'Az emlékeid nálad maradnak.': 'Your memories stay yours.',
  'A beállítások betöltése után látod, hová kerül a chat.':
    'Once settings load, you can see where your chat is sent.',
  'Az emlékeid ezen a szerveren tárolódnak.': 'Your memories are stored on this server.',
  'Újraindításkor sem vesznek el.': 'They remain available after a restart.',
  HELYI: 'LOCAL',
  'A chatelőzmény csak átmeneti.': 'Chat history is temporary.',
  'Az alkalmazás nem ment chatnaplót a lemezre.': 'The app does not save chat logs to disk.',
  'Az API-kulcs nem kerül a böngészőbe.': 'Your API key never reaches the browser.',
  'Kizárólag a szerver futásidejű beállításából származik.':
    'It is read only from the server runtime configuration.',
  'A TE SAJÁT ADATAID': 'YOUR OWN DATA',
  'elmentett emlék': 'saved memories',
  'JSON-fájlban, saját tárhelyen': 'In a JSON file on your own storage',
  'Nem osztjuk meg senkivel.': 'Never shared with anyone.',
  'SAJÁT TÁRHELYED': 'YOUR OWN STORAGE',
  'Te adod a kulcsot.': 'You hold the keys.',
  'A memóriafájl a': 'Your memory file is stored at',
  ' helyen van. Mentsd a teljes adatkönyvtárat, hogy a mentéseid is kézben maradjanak.':
    '. Back up the whole data folder to keep control of your memories.',
  'TE IRÁNYÍTASZ': 'YOU ARE IN CONTROL',
  'Felület nyelve': 'Interface language',
  English: 'English',
  'OpenAI-kompatibilis API': 'OpenAI-compatible API',
  'A törlés nem sikerült.': 'Could not delete.',
  'A kérés forrása nem engedélyezett.': 'The request origin is not allowed.',
  'A lista korlátozó paraméterei érvénytelenek.':
    'The list pagination parameters are invalid.',
  'Frissítsd a memórialistát, mielőtt módosítod az emléket.':
    'Refresh the memory list before changing this memory.',
  'A keresőkifejezés érvénytelen.': 'The search term is invalid.',
  'A memória nézete érvénytelen.': 'The memory view is invalid.',
  'Ellenőrizd a kategóriát és a memória szövegét.': 'Check the category and memory text.',
  'A memória nem található.': 'The memory was not found.',
  'A beszélgetés lejárt. Indíts új beszélgetést.':
    'This conversation has expired. Start a new conversation.',
  'A beszélgetés már feldolgozás alatt áll.': 'This conversation is already being processed.',
  'A beszélgetéslista megtelt. Próbáld újra később.':
    'The conversation list is full. Please try again later.',
  'A memóriák az üzenet feldolgozása közben megváltoztak. Küldd el újra.':
    'Your memories changed while processing the message. Please send it again.',
  'A memória már szerepel a tárolóban.': 'This memory is already in your memory store.',
  'Ez a memória már szerepel a tárolóban.': 'This memory is already in your memory store.',
  'Ez az emlék egy másik memóriával megegyezik.': 'This memory matches another memory.',
  'A memória azóta megváltozott. Töltsd újra, és próbáld ismét.':
    'This memory has changed. Refresh and try again.',
  'A memóriatár jelenleg nem érhető el.': 'The memory store is currently unavailable.',
  'A memóriatár helyreállítás alatt áll. Próbáld újra később.':
    'The memory store is recovering. Please try again later.',
  'A tárolás állapotát újra kell ellenőrizni. Próbáld újra, miután a tár ismét elérhető.':
    'The storage status needs to be checked again. Retry when storage is available.',
  'A memória mentése nem sikerült.': 'The memory could not be saved.',
  'A memória kezelése működik, a beszélgetéshez előbb állíts be egy nyelvi modellt.':
    'Memory management is available. Set up a language model to chat.',
  'A nyelvi modell érvénytelen választ adott. Próbáld újra, vagy használd a Memóriák oldalt.':
    'The language model returned an invalid response. Try again or use the Memories page.',
  'A nyelvi modell nem válaszolt időben. Próbáld újra később.':
    'The language model timed out. Please try again later.',
  'A nyelvi modell hitelesítési beállítása érvénytelen.':
    'The language model authentication settings are invalid.',
  'A kérés megszakadt. Küldd el újra.': 'The request was interrupted. Please send it again.',
  'A nyelvi modell érvénytelen választ adott.':
    'The language model returned an invalid response.',
  'A nyelvi modell most nem érhető el.': 'The language model is unavailable right now.',
  'A kérés túl nagy.': 'The request is too large.',
  'A kérés nem érvényes JSON.': 'The request is not valid JSON.',
  'A kérés feldolgozása nem sikerült.': 'The request could not be processed.',
  'Az API-végpont nem található.': 'The API endpoint was not found.',
  'Nem érhető el az alkalmazás. Ellenőrizd a kapcsolatot, és próbáld újra.':
    'The app is unavailable. Check your connection and try again.',
  'A kérés nem sikerült. Próbáld újra.': 'The request failed. Please try again.',
  'A szerver érvénytelen adatot adott vissza.': 'The server returned invalid data.',
  'Ezt a memóriát időközben módosították. Frissítsd a listát, majd próbáld újra.':
    'This memory has changed. Refresh the list and try again.',
  'A kérés nem adott egyértelmű engedélyt memória módosítására. Fogalmazz meg egy konkrét kérést.':
    'Your request did not clearly authorize a memory change. Please make a specific request.',
  'Már van egy nagyon hasonló emlék a „{category}” kategóriában. Nézd át a meglévőt, és ha más információt tartalmaz, pontosítsd a szöveget.':
    'A similar memory already exists in “{category}”. Review it and edit the text if it contains different information.',
  'A modell ezt az emlék hozzáadását javasolja. Jóváhagyás előtt ellenőrizd, és szükség esetén szerkeszd a szöveget.':
    'The model suggests adding this memory. Review it before approving, and edit the text if needed.',
  'Nem sikerült biztonságosan azonosítani a módosítandó emléket. Nyisd meg a Memóriák oldalt, vagy pontosíts.':
    'Could not safely identify the memory to change. Open the Memories page or clarify your request.',
  'A modell ezt a módosítást javasolja. Ellenőrizd a jelenlegi és az új szöveget.':
    'The model suggests this change. Review the current and proposed text.',
  'A modell ezt az emlék törlését javasolja. Ellenőrizd a kiválasztott emléket.':
    'The model suggests deleting this memory. Review the selected memory.',
  'A modell nem készített biztonságos javaslatot ehhez a kéréshez. Próbáld újra, vagy használd a Memóriák oldalt.':
    'The model could not prepare a safe suggestion for this request. Try again or use the Memories page.',
  'Adj meg egy üzenetet, amely legfeljebb 8 000 karakter.':
    'Enter a message with no more than 8,000 characters.',
  'The configured language model provider could not complete the request.':
    'The configured language model provider could not complete the request.',
  'A beszélgetés és a kiválasztott emlékek a beállított külső LLM-szolgáltatóhoz kerülnek.':
    'Your conversation and selected memories are sent to the configured external language model provider.',
  'A beszélgetés és a kiválasztott emlékek a beállított Ollama-végpontnak is elküldhetők.':
    'Your conversation and selected memories may also be sent to the configured Ollama endpoint.',
  'Nincs beállítva nyelvi modell. A memóriákat helyben, az alkalmazásból kezelheted.':
    'No language model is configured. You can manage your memories locally in the app.',
  'A memóriákat helyben kezeled.': 'You manage your memories locally.',
  'A memória szövege érvénytelen.': 'The memory text is invalid.',
  'A kategória érvénytelen.': 'The category is invalid.',
  'Az emlék nem található.': 'The memory was not found.',
  'Ezt az emléket időközben módosították. Frissítsd a listát, majd próbáld újra.':
    'This memory has changed. Refresh the list and try again.',
  'Túl sok kérés érkezett. Próbáld újra később.': 'Too many requests. Please try again later.',
  'A szolgáltató most nem érhető el. Próbáld újra később.':
    'The provider is unavailable right now. Please try again later.',
  'A szolgáltató elutasította a kérést. Ellenőrizd a modell beállításait.':
    'The provider rejected the request. Check your model settings.',
  'A szolgáltató hitelesítése sikertelen. Ellenőrizd az API-kulcsot.':
    'Provider authentication failed. Check your API key.',
  'A szolgáltató nem válaszolt időben. Próbáld újra.':
    'The provider did not respond in time. Please try again.',
  'A nyelvi modell válasza nem volt használható. Próbáld újra.':
    'The language model returned an unusable response. Please try again.',
  'A memóriatár nem érhető el. Próbáld újra később.':
    'The memory store is unavailable. Please try again later.',
  'The memory could not be loaded.': 'The memory could not be loaded.',
  'The selected memory could not be verified. Refresh the list and try again.':
    'The selected memory could not be verified. Refresh the list and try again.',
};

const hungarian: Record<string, string> = {
  toolsUsed: 'Használt eszközök: {tools}',
  'weather.getForecast': 'Időjárás-előrejelzés',
  'calendar.getEvents': 'Naptári események',
  'notes.search': 'Emlékek keresése',
  memorySaved: '„{category}” kategóriában elmentettük az emléket.',
  memoryUpdated: 'Frissítettük a „{category}” kategóriájú emléket.',
  memoryDeleted: 'Töröltük az emléket a memóriatárból.',
  conversationResetNotice: '{message} A régi beszélgetési előzményt töröltük.',
  usedMemories: '{count} emléket vettem figyelembe',
  memoryEditLabel: 'Emlék szerkesztése: {category}',
  memoryDeleteLabel: 'Emlék törlése: {category}',
};

interface LanguageContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

function getSavedLanguage(): Language {
  try {
    return window.localStorage.getItem(LANGUAGE_STORAGE_KEY) === 'hu' ? 'hu' : 'en';
  } catch {
    return 'en';
  }
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(getSavedLanguage);

  useEffect(() => {
    document.documentElement.lang = language;
    document.title =
      language === 'hu' ? 'Otthon – Home Memory Agent' : 'Home – Home Memory Agent';
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute(
        'content',
        language === 'hu'
          ? 'Saját tárhelyen futó személyes AI memória, amelyet te tartasz kézben.'
          : 'A self-hosted personal AI memory that stays under your control.',
      );
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch {
      // The language still works for the current session if storage is unavailable.
    }
  }, [language]);

  const value = useMemo(() => ({ language, setLanguage }), [language]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useI18n() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useI18n must be used inside LanguageProvider.');

  const t = useCallback(
    (key: string, values: Record<string, string | number> = {}) => {
      const dictionary = context.language === 'en' ? english : hungarian;
      const fallback = context.language === 'en' ? english[key] : undefined;
      let source = key;
      let template = dictionary[key] ?? fallback;
      const replacements = { ...values };
      if (!template) {
        for (const [pattern, translated] of Object.entries(dictionary)) {
          if (!pattern.includes('{')) continue;
          const expression = new RegExp(
            `^${escapeRegExp(pattern).replace(/\\\{[^}]+\\\}/gu, '(.+?)')}$`,
            'u',
          );
          const match = expression.exec(key);
          if (!match) continue;
          source = pattern;
          template = translated;
          [...pattern.matchAll(/\{([^}]+)\}/gu)].forEach((placeholder, index) => {
            const name = placeholder[1];
            if (name && replacements[name] === undefined)
              replacements[name] = match[index + 1] ?? '';
          });
          break;
        }
      }
      template ??= key;
      const placeholders = [...source.matchAll(/\{([^}]+)\}/gu)];
      if (!Object.keys(replacements).length && placeholders.length === 0) return template;
      return Object.entries(replacements).reduce(
        (result, [name, value]) => result.replaceAll(`{${name}}`, String(value)),
        template,
      );
    },
    [context.language],
  );

  return { ...context, t };
}

export function translateProviderNotice(notice: string, t: (key: string) => string): string {
  return t(notice);
}
