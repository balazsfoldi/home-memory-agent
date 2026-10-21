import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import type {
  MemoryAction,
  MemoryEnvelope,
  MemoryListResponse,
  SettingsResponse,
} from '@home-memory/shared';
import { ApiClientError, api } from './api/client.js';
import { LanguageProvider, useI18n } from './i18n.js';

type Page = 'chat' | 'memories' | 'settings';
type ChatEntry = {
  id: string;
  role: 'user' | 'assistant';
  message: string;
  proposal?: NonNullable<Awaited<ReturnType<typeof api.chat>>['proposal']>;
  usedMemoryIds?: string[];
  pending?: boolean;
  result?: 'accepted' | 'dismissed';
};

function priorityLabel(
  priority: 'low' | 'normal' | 'high',
  t: (key: string) => string,
): string {
  return priority === 'high' ? t('Fontos') : priority === 'low' ? t('Alacsony') : t('Normál');
}

function PrioritySelect({
  value,
  onChange,
}: {
  value: 'low' | 'normal' | 'high';
  onChange: (value: 'low' | 'normal' | 'high') => void;
}) {
  const { t } = useI18n();
  return (
    <select value={value} onChange={(event) => onChange(event.target.value as typeof value)}>
      <option value="low">{t('Alacsony')}</option>
      <option value="normal">{t('Normál')}</option>
      <option value="high">{t('Fontos')}</option>
    </select>
  );
}

function Icon({
  name,
  size = 20,
}: {
  name:
    | 'chat'
    | 'memory'
    | 'settings'
    | 'plus'
    | 'search'
    | 'arrow'
    | 'send'
    | 'back'
    | 'check'
    | 'close'
    | 'lock'
    | 'spark'
    | 'dot'
    | 'trash'
    | 'edit'
    | 'book'
    | 'moon'
    | 'refresh';
  size?: number;
}) {
  const paths: Record<typeof name, ReactNode> = {
    chat: (
      <>
        <path d="M20.1 11.4a7.8 7.8 0 0 1-8.1 7.4 8.6 8.6 0 0 1-3.7-.8l-4.3 1 1.1-3.8A7.1 7.1 0 0 1 3 10.4 7.8 7.8 0 0 1 11 3c4.5 0 8.1 3.8 8.1 8.4Z" />
        <path d="M8 11h.01M12 11h.01M16 11h.01" />
      </>
    ),
    memory: (
      <>
        <path d="M7 3h7l4 4v14H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
        <path d="M14 3v5h5M9 12h6M9 16h6" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path
          d="m19.4 15 .1.1a2 2 0 1 1-2.8 2.8l-.1-.1a2 2 0 0 0-3.4 1.4v.3a2 2 0 1 1-4 0v-.2a2 2 0 0 0-3.4-1.5l-.1.1a2 2 0 0 1-2.8-2.8l.1-.1A2 2 0 0 0 1.6 12H1.5a2 2 0 1 1 0-4h.2a2 2 0 0 0 1.5-3.4L3.1 4.5a2 2 0 0 1 2.8-2.8l.1.1A2 2 0 0 0 9.4.3V.2a2 2 0 1 1 4 0v.2a2 2 0 0 0 3.4 1.5l.1-.1a2 2 0 0 1 2.8 2.8l-.1.1a2 2 0 0 0 1.5 3.4h.2a2 2 0 1 1 0 4h-.2a2 2 0 0 0-1.7 2.9Z"
          transform="translate(1.5 1.5) scale(.83)"
        />
      </>
    ),
    plus: (
      <>
        <path d="M12 5v14M5 12h14" />
      </>
    ),
    search: (
      <>
        <circle cx="10.8" cy="10.8" r="6.3" />
        <path d="m16 16 4 4" />
      </>
    ),
    arrow: (
      <>
        <path d="M5 12h14M13 6l6 6-6 6" />
      </>
    ),
    send: (
      <>
        <path d="M21 3 10 14M21 3l-7 18-4-7-7-4 18-7Z" />
      </>
    ),
    back: (
      <>
        <path d="m15 18-6-6 6-6" />
      </>
    ),
    check: (
      <>
        <path d="m5 12 4.3 4.3L19 6.8" />
      </>
    ),
    close: (
      <>
        <path d="m18 6-12 12M6 6l12 12" />
      </>
    ),
    lock: (
      <>
        <rect x="4" y="10" width="16" height="11" rx="2.5" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
      </>
    ),
    spark: (
      <>
        <path d="m12 3-1.4 5.6L5 10l5.6 1.4L12 17l1.4-5.6L19 10l-5.6-1.4L12 3Z" />
        <path d="m19 14-.8 2.2L16 17l2.2.8L19 20l.8-2.2L22 17l-2.2-.8L19 14Z" />
      </>
    ),
    dot: (
      <>
        <circle cx="12" cy="12" r="5" fill="currentColor" stroke="none" />
      </>
    ),
    trash: (
      <>
        <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
      </>
    ),
    edit: (
      <>
        <path d="m15 5 4 4M4 20l4.1-.8L19 8.3a2.8 2.8 0 0 0-4-4L4.1 15.2 4 20Z" />
      </>
    ),
    book: (
      <>
        <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v17H6.5A2.5 2.5 0 0 0 4 22V5.5Z" />
        <path d="M4 6v16M9 7h7M9 11h6" />
      </>
    ),
    moon: (
      <>
        <path d="M20.5 15.5A8.5 8.5 0 0 1 8.5 3.5 8.5 8.5 0 1 0 20.5 15.5Z" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 7v5h-5M4 17v-5h5" />
        <path d="M5.6 9a7 7 0 0 1 11.5-2L20 12M4 12l2.9 5a7 7 0 0 0 11.5-2" />
      </>
    ),
  };
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

export function App() {
  return (
    <LanguageProvider>
      <AppContent />
    </LanguageProvider>
  );
}

function AppContent() {
  const { language, setLanguage, t } = useI18n();
  const translateRef = useRef(t);
  useEffect(() => {
    translateRef.current = t;
  }, [t]);
  const [page, setPage] = useState<Page>('chat');
  const [memories, setMemories] = useState<MemoryEnvelope[]>([]);
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [memoryTotal, setMemoryTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatEntry[]>([]);
  const [chatText, setChatText] = useState('');
  const [sending, setSending] = useState(false);
  const [creating, setCreating] = useState(false);
  const conversationId = useRef<string | undefined>(undefined);
  const activeChat = useRef<AbortController | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const pageContent: Record<Page, { eyebrow: string; title: string; description: string }> = {
    chat: {
      eyebrow: t('A TE SZEMÉLYES ASSZISZTENSED'),
      title: t('Emlékszem, ami fontos.'),
      description: t(
        'A kérdésedre válaszolok, figyelembe véve azokat az emlékeket, amelyek tényleg segítenek.',
      ),
    },
    memories: {
      eyebrow: t('A TE ADATAID, A TE DÖNTÉSED'),
      title: t('Amit érdemes észben tartani.'),
      description: t(
        'Nézd át, pontosítsd vagy felejtsd el a személyes emlékeidet, amikor csak szeretnéd.',
      ),
    },
    settings: {
      eyebrow: t('MINDEN FELETT TE RENDELKEZEL'),
      title: t('A saját tárhelyeden.'),
      description: t(
        'Az emlékeid az otthoni szerveren maradnak. Te döntöd el, hová küldesz belőlük a válaszaidhoz.',
      ),
    },
  };
  const currentPage = pageContent[page];

  const loadMemories = useCallback(async (q?: string) => {
    const result: MemoryListResponse = await api.listMemories(q ? { q } : {});
    setMemories(result.items);
    setMemoryTotal(result.total);
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([api.listMemories(), api.settings()])
      .then(([memoryResult, configuration]) => {
        if (!active) return;
        setMemories(memoryResult.items);
        setMemoryTotal(memoryResult.total);
        setSettings(configuration);
        setError('');
      })
      .catch((failure: unknown) => {
        if (active)
          setError(
            translateRef.current(
              failure instanceof Error
                ? failure.message
                : 'Nem sikerült betölteni az alkalmazást.',
            ),
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      activeChat.current?.abort();
    };
  }, []);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [chatMessages, sending]);

  useEffect(() => {
    if (page !== 'memories') return;
    const timer = window.setTimeout(() => {
      loadMemories(search.trim() || undefined).catch((failure: unknown) => {
        setError(
          t(
            failure instanceof Error
              ? failure.message
              : 'Nem sikerült betölteni az emlékeket.',
          ),
        );
      });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [loadMemories, page, search, t]);

  const categories = useMemo(
    () =>
      [...new Set(memories.map(({ memory }) => memory.category))].sort((a, b) =>
        a.localeCompare(b, language === 'hu' ? 'hu' : 'en'),
      ),
    [language, memories],
  );

  const clearConversationAfterMutation = useCallback(() => {
    activeChat.current?.abort();
    activeChat.current = null;
    conversationId.current = undefined;
    setChatMessages([]);
  }, []);

  async function submitChat(message = chatText): Promise<void> {
    const text = message.trim();
    if (!text || sending) return;
    const controller = new AbortController();
    activeChat.current = controller;
    setSending(true);
    setError('');
    setNotice('');
    setChatMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: 'user', message: text },
    ]);
    setChatText('');
    try {
      const result = await api.chat(
        {
          message: text,
          ...(conversationId.current ? { conversationId: conversationId.current } : {}),
        },
        controller.signal,
      );
      conversationId.current = result.conversationId;
      if (result.memoryContextChanged) {
        setChatMessages([
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            message: t(
              'Az emlékeid közben megváltoztak, ezért új beszélgetési előzménnyel folytatom.',
            ),
          },
        ]);
      }
      setChatMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          message: result.message,
          ...(result.proposal ? { proposal: result.proposal } : {}),
          ...(result.usedMemoryIds.length ? { usedMemoryIds: result.usedMemoryIds } : {}),
        },
      ]);
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure instanceof ApiClientError && failure.status === 410) {
        conversationId.current = undefined;
        setChatMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            message: t(
              'A beszélgetés lejárt. Küldd el újra az üzeneted, és új előzményt kezdek.',
            ),
          },
        ]);
      } else {
        setChatMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            message: t(
              failure instanceof Error ? failure.message : 'A válasz most nem érhető el.',
            ),
          },
        ]);
      }
    } finally {
      if (activeChat.current === controller) activeChat.current = null;
      setSending(false);
    }
  }

  function onChatKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submitChat();
    }
  }

  async function handleMemoryCreated(memory: MemoryEnvelope): Promise<void> {
    setCreating(false);
    clearConversationAfterMutation();
    await loadMemories(search.trim() || undefined);
    setNotice(t('memorySaved', { category: memory.memory.category }));
  }

  async function handleMemoryChanged(message: string): Promise<void> {
    clearConversationAfterMutation();
    await loadMemories(search.trim() || undefined);
    setNotice(message);
    setError('');
  }

  async function acceptProposal(entry: ChatEntry): Promise<void> {
    const proposal = entry.proposal;
    if (!proposal || entry.pending) return;
    setChatMessages((items) =>
      items.map((item) => (item.id === entry.id ? { ...item, pending: true } : item)),
    );
    try {
      const action = proposal.action;
      let message: string;
      if (action.action === 'CREATE_MEMORY') {
        const result = await api.createMemory(action.memory);
        message = t('memorySaved', { category: result.memory.category });
      } else if (action.action === 'UPDATE_MEMORY' && proposal.etag) {
        const result = await api.updateMemory(action.id, proposal.etag, action.memory);
        message = t('memoryUpdated', { category: result.memory.category });
      } else if (action.action === 'DELETE_MEMORY' && proposal.etag) {
        await api.deleteMemory(action.id, proposal.etag);
        message = t('memoryDeleted');
      } else {
        throw new Error(
          t('Nem sikerült ellenőrizni a kiválasztott emléket. Töltsd újra a listát.'),
        );
      }
      clearConversationAfterMutation();
      await loadMemories(search.trim() || undefined);
      setNotice(message);
      setChatMessages([
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          message: t('conversationResetNotice', { message }),
        },
      ]);
      setError('');
    } catch (failure) {
      setChatMessages((items) =>
        items.map((item) => (item.id === entry.id ? { ...item, pending: false } : item)),
      );
      setError(
        t(
          failure instanceof Error
            ? failure.message
            : 'A javaslatot nem sikerült végrehajtani.',
        ),
      );
    }
  }

  function dismissProposal(id: string): void {
    setChatMessages((items) =>
      items.map((item) => {
        if (item.id !== id) return item;
        const next = { ...item };
        delete next.proposal;
        return { ...next, result: 'dismissed' };
      }),
    );
  }

  function editProposal(id: string, action: MemoryAction): void {
    setChatMessages((items) =>
      items.map((item) =>
        item.id === id && item.proposal
          ? { ...item, proposal: { ...item.proposal, action } }
          : item,
      ),
    );
  }

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      await Promise.all([
        loadMemories(search.trim() || undefined),
        api.settings().then(setSettings),
      ]);
    } catch (failure) {
      setError(
        t(failure instanceof Error ? failure.message : 'Az adatok frissítése nem sikerült.'),
      );
    } finally {
      setLoading(false);
    }
  }, [loadMemories, search, t]);

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label={t('Fő navigáció')}>
        <a
          className="brand"
          href="#home"
          onClick={(event) => {
            event.preventDefault();
            setPage('chat');
          }}
          aria-label={t('Home Memory Agent, kezdőlap')}
        >
          <span className="brand-mark">
            <Icon name="book" size={21} />
          </span>
          <span className="brand-name">
            home<span>memory</span>
          </span>
        </a>

        <div className="nav-label">{t('MUNKATERÜLET')}</div>
        <nav className="navigation">
          {(
            [
              ['chat', t('Beszélgetés'), 'chat'],
              ['memories', t('Emlékeim'), 'memory'],
              ['settings', t('Beállítások'), 'settings'],
            ] as const
          ).map(([id, label, icon]) => (
            <button
              key={id}
              className={`nav-link${page === id ? ' active' : ''}`}
              onClick={() => {
                setPage(id);
                setError('');
                setNotice('');
              }}
              aria-current={page === id ? 'page' : undefined}
            >
              <Icon name={icon} size={19} />
              <span>{label}</span>
              {id === 'memories' && <span className="nav-count">{memoryTotal}</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-spacer" />
        <div className="sidebar-memory-card">
          <div className="sidebar-lock">
            <Icon name="lock" size={17} />
          </div>
          <div>
            <p>{t('Csak a tiéd.')}</p>
            <span>{t('Az emlékeid a saját tárhelyeden maradnak.')}</span>
          </div>
          <div className="privacy-indicator">
            <Icon name="dot" size={12} />
          </div>
        </div>
        <label className="language-picker">
          <span>{t('Felület nyelve')}</span>
          <select
            aria-label={t('Felület nyelve')}
            value={language}
            onChange={(event) => setLanguage(event.target.value === 'hu' ? 'hu' : 'en')}
          >
            <option value="en">English</option>
            <option value="hu">Magyar</option>
          </select>
        </label>
        <div className="sidebar-footer">
          <span className="footer-avatar">H</span>
          <span>Home Memory Agent</span>
          <span className="version-tag">v0.2.5</span>
        </div>
      </aside>

      <main className={`main-content page-${page}`}>
        <header className="topbar">
          <div className="breadcrumb">
            <span>{t('Otthon')}</span>
            <span className="breadcrumb-slash">/</span>
            <strong>
              {page === 'chat'
                ? t('Beszélgetés')
                : page === 'memories'
                  ? t('Emlékeim')
                  : t('Beállítások')}
            </strong>
          </div>
          <div className="topbar-status">
            <span className={`status-dot${settings?.configured ? ' connected' : ''}`} />
            <span>
              {settings?.configured
                ? t('Asszisztens csatlakoztatva')
                : t('Az asszisztens szünetel')}
            </span>
            <button
              className="icon-button refresh-button"
              aria-label={t('Adatok frissítése')}
              onClick={() => void refresh()}
            >
              <Icon name="refresh" size={17} />
            </button>
          </div>
        </header>

        <div className="page-wrap">
          <div className="page-heading">
            <div className="page-eyebrow">
              <span className="eyebrow-line" />
              {currentPage.eyebrow}
            </div>
            <h1>{currentPage.title}</h1>
            <p className="page-description">{currentPage.description}</p>
          </div>

          {error && (
            <div className="alert alert-error" role="alert">
              <span>{error}</span>
              <button
                className="inline-icon"
                aria-label={t('Hiba bezárása')}
                onClick={() => setError('')}
              >
                <Icon name="close" size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="alert alert-success" role="status">
              <Icon name="check" size={17} />
              <span>{notice}</span>
              <button
                className="inline-icon"
                aria-label={t('Értesítés bezárása')}
                onClick={() => setNotice('')}
              >
                <Icon name="close" size={16} />
              </button>
            </div>
          )}

          {page === 'chat' && (
            <ChatPanel
              messages={chatMessages}
              text={chatText}
              sending={sending}
              configured={settings?.configured ?? false}
              categories={categories}
              bottomRef={chatEnd}
              onTextChange={setChatText}
              onKeyDown={onChatKeyDown}
              onSend={() => void submitChat()}
              onCancel={() => activeChat.current?.abort()}
              onSuggestion={(suggestion) => void submitChat(suggestion)}
              onAccept={(entry) => void acceptProposal(entry)}
              onDismiss={dismissProposal}
              onEditProposal={editProposal}
              onOpenSettings={() => setPage('settings')}
            />
          )}

          {page === 'memories' && (
            <section className="memories-panel">
              <div className="section-toolbar">
                <div>
                  <div className="section-kicker">{t('A TE PRIVÁT TÁRAD')}</div>
                  <h2>
                    {t('Memóriák')} <span className="total-pill">{memoryTotal}</span>
                  </h2>
                </div>
                <button
                  className="button button-primary"
                  onClick={() => setCreating((value) => !value)}
                >
                  <Icon name={creating ? 'close' : 'plus'} size={17} />
                  {creating ? t('Bezárás') : t('Új emlék')}
                </button>
              </div>

              {creating && (
                <CreateMemoryForm
                  categories={categories}
                  onCancel={() => setCreating(false)}
                  onCreated={handleMemoryCreated}
                />
              )}

              <label className="search-field">
                <Icon name="search" size={18} />
                <input
                  aria-label={t('Keresés az emlékek között')}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t('Keresés az emlékek között...')}
                />
                <span className="search-shortcut">/</span>
              </label>

              <div className="memory-list-header">
                <span>
                  {search
                    ? `${memoryTotal} ${t('TALÁLAT')}`
                    : `${memoryTotal} ${t('ELMENTETT EMLÉK')}`}
                </span>
                <span>{t('SZERKESZTÉS ÉS TÖRLÉS')}</span>
              </div>
              {loading ? (
                <div className="empty-state">
                  <div className="spinner" />
                  <p>{t('Betöltés…')}</p>
                </div>
              ) : memories.length ? (
                <div className="memory-list">
                  {memories.map((memory) => (
                    <MemoryCard
                      key={memory.memory.id}
                      envelope={memory}
                      onChanged={handleMemoryChanged}
                    />
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <div className="empty-icon">
                    <Icon name={search ? 'search' : 'book'} size={24} />
                  </div>
                  <h3>
                    {search
                      ? t('Nem találtam egyező emléket.')
                      : t('Itt kezdődnek a jó beszélgetések.')}
                  </h3>
                  <p>
                    {search
                      ? t('Próbálj másik keresőkifejezést, vagy ellenőrizd a kategóriákat.')
                      : t(
                          'Adj hozzá egy emléket, és az asszisztensed máris személyre szabottabb választ adhat.',
                        )}
                  </p>
                  {!search && (
                    <button
                      className="button button-primary"
                      onClick={() => setCreating(true)}
                    >
                      <Icon name="plus" size={16} />
                      {t('Első emlék hozzáadása')}
                    </button>
                  )}
                </div>
              )}
              <div className="data-note">
                <Icon name="lock" size={15} />
                <span>{t('Minden emléked ezen a szerveren marad.')}</span>
              </div>
            </section>
          )}

          {page === 'settings' && (
            <SettingsPanel
              settings={settings}
              loading={loading}
              memoryTotal={memoryTotal}
              onRefresh={() => void refresh()}
            />
          )}
        </div>
        <footer className="page-footer">
          <span>{t('Az emlékeid a tiéid.')}</span>
          <span>{t('Önálló, helyi és a tiéd.')}</span>
        </footer>
      </main>
    </div>
  );
}

function ChatPanel(props: {
  messages: ChatEntry[];
  text: string;
  sending: boolean;
  configured: boolean;
  categories: string[];
  bottomRef: RefObject<HTMLDivElement | null>;
  onTextChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  onCancel: () => void;
  onSuggestion: (value: string) => void;
  onAccept: (entry: ChatEntry) => void;
  onDismiss: (id: string) => void;
  onEditProposal: (id: string, action: MemoryAction) => void;
  onOpenSettings: () => void;
}) {
  const { language, t } = useI18n();
  const showWelcome = props.messages.length === 0;
  return (
    <section
      className={`chat-panel${showWelcome ? ' chat-welcome' : ''}`}
      aria-label={t('Beszélgetés az asszisztenssel')}
    >
      {showWelcome ? (
        <div className="welcome-content">
          <div className="assistant-orb">
            <div className="orb-center">
              <Icon name="spark" size={25} />
            </div>
          </div>
          <div className="welcome-overline">{t('HOGYAN SEGÍTHETEK?')}</div>
          <h2>
            {t('Ismerlek. Már amennyire')}
            <br />
            {t('az emlékeid engedik.')}
          </h2>
          <p className="welcome-copy">
            {t(
              'Kérdezz nyugodtan, vagy mondd el, mire emlékezzek. Egy jó beszélgetés néha csak egy apró emléken múlik.',
            )}
          </p>
          {!props.configured && (
            <button className="llm-setup-banner" onClick={props.onOpenSettings}>
              <span className="setup-icon">
                <Icon name="spark" size={16} />
              </span>
              <span>
                <strong>{t('Az asszisztens beállításra vár')}</strong>
                <span>{t('Add meg az LLM-szolgáltató adatait a .env fájlban.')}</span>
              </span>
              <Icon name="arrow" size={17} />
            </button>
          )}
          <div className="suggestion-grid">
            {[
              {
                icon: 'moon' as const,
                label: t('Mit vigyek magammal?'),
                question:
                  language === 'en'
                    ? 'What should I pack for a weekend hiking trip?'
                    : 'Mit vigyek magammal egy hétvégi túrára?',
              },
              {
                icon: 'spark' as const,
                label: t('Mire emlékszel rólam?'),
                question:
                  language === 'en'
                    ? 'What do you remember about me?'
                    : 'Mire emlékszel rólam?',
              },
              {
                icon: 'memory' as const,
                label: t('Jegyezd meg ezt'),
                question:
                  language === 'en'
                    ? 'Remember that I like quiet places when travelling.'
                    : 'Jegyezd meg, hogy utazáskor a csendes helyeket szeretem.',
              },
            ].map((suggestion) => (
              <button
                className="suggestion-card"
                key={suggestion.label}
                disabled={!props.configured}
                onClick={() => props.onSuggestion(suggestion.question)}
              >
                <span className="suggestion-icon">
                  <Icon name={suggestion.icon} size={17} />
                </span>
                <span>{suggestion.label}</span>
                <Icon name="arrow" size={16} />
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="conversation-list">
          {props.messages.map((entry) => (
            <div key={entry.id} className={`message-row ${entry.role}`}>
              {entry.role === 'assistant' && (
                <div className="message-avatar">
                  <Icon name="spark" size={16} />
                </div>
              )}
              <div className="message-body">
                <div className="message-label">
                  {entry.role === 'user' ? t('Te') : 'Home Memory'}
                </div>
                <div className="message-bubble">{t(entry.message)}</div>
                {entry.usedMemoryIds && entry.usedMemoryIds.length > 0 && (
                  <span className="used-memories">
                    <Icon name="memory" size={13} />
                    {entry.usedMemoryIds.length === 1
                      ? t('1 emléket vettem figyelembe')
                      : t('usedMemories', { count: entry.usedMemoryIds.length })}
                  </span>
                )}
                {entry.proposal && (
                  <ProposalCard
                    entry={entry}
                    onAccept={() => props.onAccept(entry)}
                    onDismiss={() => props.onDismiss(entry.id)}
                    onEdit={(action) => props.onEditProposal(entry.id, action)}
                  />
                )}
              </div>
            </div>
          ))}
          {props.sending && (
            <div className="message-row assistant">
              <div className="message-avatar">
                <Icon name="spark" size={16} />
              </div>
              <div className="message-body">
                <div className="message-label">Home Memory</div>
                <div className="typing-indicator">
                  <i />
                  <i />
                  <i />
                </div>
              </div>
            </div>
          )}
          <div ref={props.bottomRef} />
        </div>
      )}

      <div className="composer-wrap">
        {!props.configured && !showWelcome && (
          <div className="chat-paused-note">
            <Icon name="lock" size={14} />
            {t('A chathez nincs beállítva nyelvi modell. A memóriáid továbbra is kezelhetők.')}
          </div>
        )}
        <div className={`chat-composer${!props.configured ? ' composer-disabled' : ''}`}>
          <textarea
            aria-label={t('Üzenet az asszisztensnek')}
            placeholder={
              props.configured
                ? t('Írj egy üzenetet…')
                : t('Először állíts be egy nyelvi modellt a .env fájlban…')
            }
            value={props.text}
            disabled={!props.configured || props.sending}
            maxLength={8_000}
            rows={1}
            onChange={(event) => props.onTextChange(event.target.value)}
            onKeyDown={props.onKeyDown}
          />
          {props.sending ? (
            <button
              className="stop-send"
              aria-label={t('Kérés megszakítása')}
              onClick={props.onCancel}
            >
              <span />
            </button>
          ) : (
            <button
              className="send-button"
              aria-label={t('Üzenet küldése')}
              disabled={!props.text.trim() || !props.configured}
              onClick={props.onSend}
            >
              <Icon name="send" size={18} />
            </button>
          )}
        </div>
        <div className="composer-caption">
          <span>
            <Icon name="lock" size={13} />
            {t('Az emlékeid a saját tárhelyeden maradnak.')}
          </span>
          <span>{t('Enter küldés · Shift + Enter új sor')}</span>
        </div>
      </div>
    </section>
  );
}

function ProposalCard({
  entry,
  onAccept,
  onDismiss,
  onEdit,
}: {
  entry: ChatEntry;
  onAccept: () => void;
  onDismiss: () => void;
  onEdit: (action: MemoryAction) => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [category, setCategory] = useState('');
  const [content, setContent] = useState('');
  const [priority, setPriority] = useState<'low' | 'normal' | 'high'>('normal');
  const proposal = entry.proposal;
  if (!proposal) return null;
  const { action, currentMemory } = proposal;
  const title =
    action.action === 'CREATE_MEMORY'
      ? t('Új emlék javaslat')
      : action.action === 'UPDATE_MEMORY'
        ? t('Módosítási javaslat')
        : t('Törlési javaslat');
  const newContent = action.action === 'DELETE_MEMORY' ? null : action.memory.content;
  const proposedPriority =
    action.action === 'DELETE_MEMORY'
      ? null
      : (action.memory.priority ?? currentMemory?.priority ?? 'normal');
  function startEditing(): void {
    if (action.action === 'DELETE_MEMORY') return;
    setCategory(action.memory.category);
    setContent(action.memory.content);
    setPriority(action.memory.priority ?? currentMemory?.priority ?? 'normal');
    setEditing(true);
  }
  function saveEdit(): void {
    if (action.action === 'DELETE_MEMORY') return;
    onEdit({
      ...action,
      memory: { category: category.trim(), content: content.trim(), priority },
    });
    setEditing(false);
  }
  return (
    <div className="proposal-card">
      <div className="proposal-header">
        <span className="proposal-icon">
          <Icon name="spark" size={16} />
        </span>
        <div>
          <strong>{title}</strong>
          <span>
            {proposal.source === 'automatic'
              ? t('Automatikus emlékötlet')
              : t('A kérésed alapján')}
            {t(' · ellenőrizd jóváhagyás előtt.')}
          </span>
        </div>
        <span className="approval-label">{t('A TE DÖNTÉSED')}</span>
      </div>
      {currentMemory && (
        <div className="proposal-old">
          <span>
            {action.action === 'DELETE_MEMORY' ? t('EZ AZ EMLÉK TÖRLŐDNE') : t('MOST')}
          </span>
          <p>{currentMemory.content}</p>
          <small>
            {currentMemory.category} · {priorityLabel(currentMemory.priority, t)}
          </small>
        </div>
      )}
      {newContent && (
        <div className="proposal-new">
          <span>{currentMemory ? t('JAVASOLT SZÖVEG') : t('ELMENTENDŐ SZÖVEG')}</span>
          <p>{newContent}</p>
          <small>
            {action.action === 'DELETE_MEMORY'
              ? ''
              : `${action.memory.category} · ${priorityLabel(proposedPriority ?? 'normal', t)}`}
          </small>
        </div>
      )}
      {editing && action.action !== 'DELETE_MEMORY' && (
        <div className="proposal-edit-form">
          <label>
            {t('Kategória')}
            <input
              value={category}
              maxLength={80}
              onChange={(event) => setCategory(event.target.value)}
            />
          </label>
          <label>
            {t('Javasolt emlék')}
            <textarea
              value={content}
              maxLength={2_000}
              rows={3}
              onChange={(event) => setContent(event.target.value)}
            />
          </label>
          <label>
            {t('Prioritás')}
            <PrioritySelect value={priority} onChange={setPriority} />
          </label>
          <div className="proposal-edit-actions">
            <button
              className="button button-quiet button-small"
              onClick={() => setEditing(false)}
            >
              {t('Mégse')}
            </button>
            <button
              className="button button-primary button-small"
              disabled={!category.trim() || !content.trim()}
              onClick={saveEdit}
            >
              {t('Módosítás alkalmazása')}
            </button>
          </div>
        </div>
      )}
      {entry.result === 'accepted' || entry.result === 'dismissed' ? (
        <div className="proposal-dismissed">
          <Icon name="check" size={15} />
          {entry.result === 'accepted'
            ? t('A javaslat mentése sikerült.')
            : t('A javaslatot elutasítottad.')}
        </div>
      ) : (
        <>
          {action.action !== 'DELETE_MEMORY' && !editing && (
            <div className="proposal-edit-trigger">
              <button
                className="button button-quiet button-small"
                disabled={entry.pending}
                onClick={startEditing}
              >
                {t('Javaslat szerkesztése')}
              </button>
            </div>
          )}
          <div className="proposal-actions">
            <button
              className="button button-quiet"
              disabled={entry.pending}
              onClick={onDismiss}
            >
              {t('Elutasítás')}
            </button>
            <button
              className={`button ${action.action === 'DELETE_MEMORY' ? 'button-danger' : 'button-primary'}`}
              disabled={entry.pending}
              onClick={onAccept}
            >
              <Icon name={entry.pending ? 'dot' : 'check'} size={15} />
              {entry.pending ? t('Mentés…') : t('Jóváhagyom')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function CreateMemoryForm({
  categories,
  onCancel,
  onCreated,
}: {
  categories: string[];
  onCancel: () => void;
  onCreated: (memory: MemoryEnvelope) => Promise<void>;
}) {
  const { t } = useI18n();
  const [category, setCategory] = useState('');
  const [content, setContent] = useState('');
  const [priority, setPriority] = useState<'low' | 'normal' | 'high'>('normal');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await onCreated(await api.createMemory({ category, content, priority }));
    } catch (failure) {
      setError(t(failure instanceof Error ? failure.message : 'A mentés nem sikerült.'));
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <form className="memory-form create-memory-form" onSubmit={(event) => void submit(event)}>
      <div className="form-topline">
        <span className="form-mark">
          <Icon name="plus" size={18} />
        </span>
        <div>
          <strong>{t('Egy új, fontos emlék')}</strong>
          <span>{t('Röviden írd le úgy, hogy később is érthető legyen.')}</span>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label={t('Bezárás')}
          onClick={onCancel}
        >
          <Icon name="close" size={18} />
        </button>
      </div>
      <label>
        {t('Kategória')}
        <input
          required
          list="memory-category-options"
          autoComplete="off"
          placeholder={t('Például: Utazás, Otthon…')}
          maxLength={80}
          value={category}
          onChange={(event) => setCategory(event.target.value)}
        />
        <datalist id="memory-category-options">
          {categories.map((item) => (
            <option key={item} value={item} />
          ))}
        </datalist>
      </label>
      <label>
        {t('Mi legyen az emlék?')}
        <textarea
          required
          placeholder={t(
            'Például: Csendes, természetközeli szállásokat keresek, ha kirándulni megyek.',
          )}
          maxLength={2_000}
          rows={3}
          value={content}
          onChange={(event) => setContent(event.target.value)}
        />
      </label>
      <label>
        {t('Prioritás')}
        <PrioritySelect value={priority} onChange={setPriority} />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button className="button button-quiet" type="button" onClick={onCancel}>
          {t('Mégse')}
        </button>
        <button className="button button-primary" disabled={submitting}>
          {submitting ? t('Mentés…') : t('Emlék mentése')}
          <Icon name="arrow" size={16} />
        </button>
      </div>
    </form>
  );
}

function MemoryCard({
  envelope,
  onChanged,
}: {
  envelope: MemoryEnvelope;
  onChanged: (message: string) => Promise<void>;
}) {
  const { language, t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [category, setCategory] = useState(envelope.memory.category);
  const [content, setContent] = useState(envelope.memory.content);
  const [priority, setPriority] = useState(envelope.memory.priority);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const memory = envelope.memory;

  useEffect(() => {
    setCategory(memory.category);
    setContent(memory.content);
    setPriority(memory.priority);
    setEditing(false);
    setConfirmDelete(false);
    setError('');
  }, [memory.id, envelope.etag, memory.category, memory.content, memory.priority]);

  async function save(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.updateMemory(memory.id, envelope.etag, { category, content, priority });
      setEditing(false);
      await onChanged(t('memoryUpdated', { category: category.trim() }));
    } catch (failure) {
      setError(t(failure instanceof Error ? failure.message : 'A mentés nem sikerült.'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    setBusy(true);
    setError('');
    try {
      await api.deleteMemory(memory.id, envelope.etag);
      await onChanged(t('memoryDeleted'));
    } catch (failure) {
      setError(t(failure instanceof Error ? failure.message : 'A törlés nem sikerült.'));
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  return (
    <article className="memory-card">
      <div className="memory-card-icon">
        <Icon name="book" size={18} />
      </div>
      <div className="memory-card-content">
        {editing ? (
          <form className="memory-edit-form" onSubmit={(event) => void save(event)}>
            <label>
              {t('Kategória')}
              <input
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                maxLength={80}
                required
              />
            </label>
            <label>
              {t('Az emlék szövege')}
              <textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                maxLength={2_000}
                required
                rows={3}
              />
            </label>
            <label>
              {t('Prioritás')}
              <PrioritySelect value={priority} onChange={setPriority} />
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="form-actions">
              <button
                className="button button-quiet"
                type="button"
                onClick={() => {
                  setEditing(false);
                  setError('');
                }}
              >
                {t('Mégse')}
              </button>
              <button className="button button-primary button-small" disabled={busy}>
                {busy ? t('Mentés…') : t('Módosítás mentése')}
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="memory-card-meta">
              <span className="category-tag">{memory.category}</span>
              <span className={`priority-tag priority-${memory.priority}`}>
                {priorityLabel(memory.priority, t)}
              </span>
              <span className="memory-date">
                {t('Módosítva')}{' '}
                {new Intl.DateTimeFormat(language === 'hu' ? 'hu-HU' : 'en-US', {
                  dateStyle: 'medium',
                }).format(new Date(memory.updatedAt))}
              </span>
            </div>
            <p className="memory-content-text">{memory.content}</p>
          </>
        )}
        {error && !editing && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {confirmDelete && !editing && (
          <div className="confirm-delete">
            <span>{t('Biztosan törlöd ezt az emléket? A törlés végleges.')}</span>
            <button
              className="button button-quiet button-small"
              onClick={() => setConfirmDelete(false)}
            >
              {t('Mégse')}
            </button>
            <button
              className="button button-danger button-small"
              disabled={busy}
              onClick={() => void remove()}
            >
              {busy ? t('Törlés…') : t('Igen, törlöm')}
            </button>
          </div>
        )}
      </div>
      {!editing && !confirmDelete && (
        <div className="memory-actions">
          <button
            className="icon-button"
            aria-label={t('memoryEditLabel', { category: memory.category })}
            onClick={() => {
              setEditing(true);
              setConfirmDelete(false);
            }}
          >
            <Icon name="edit" size={16} />
          </button>
          <button
            className="icon-button icon-button-danger"
            aria-label={t('memoryDeleteLabel', { category: memory.category })}
            onClick={() => setConfirmDelete(true)}
          >
            <Icon name="trash" size={16} />
          </button>
        </div>
      )}
    </article>
  );
}

function SettingsPanel({
  settings,
  loading,
  memoryTotal,
  onRefresh,
}: {
  settings: SettingsResponse | null;
  loading: boolean;
  memoryTotal: number;
  onRefresh: () => void;
}) {
  const { t } = useI18n();
  return (
    <section className="settings-layout" aria-label={t('Adatvédelmi és modellbeállítások')}>
      <div className="settings-main">
        <article className="settings-card provider-card">
          <div className="settings-card-heading">
            <span className="settings-card-icon violet">
              <Icon name="spark" size={18} />
            </span>
            <div>
              <span className="section-kicker">{t('SZOLGÁLTATÓ')}</span>
              <h2>{t('A beszélgetésed modellje.')}</h2>
            </div>
            <span className={`config-badge${settings?.configured ? ' config-ready' : ''}`}>
              <span className="status-dot" />
              {settings?.configured ? t('CSATLAKOZTATVA') : t('BEÁLLÍTÁSRA VÁR')}
            </span>
          </div>
          <div className="provider-summary">
            <span className="provider-logo">
              {settings?.provider === 'ollama'
                ? 'O'
                : settings?.provider === 'none'
                  ? '–'
                  : 'AI'}
            </span>
            <div>
              <strong>
                {loading
                  ? t('Ellenőrzés…')
                  : settings?.provider === 'ollama'
                    ? 'Ollama'
                    : settings?.provider === 'none'
                      ? t('Nincs beállítva')
                      : t('OpenAI-kompatibilis API')}
              </strong>
              <span>
                {settings?.configured
                  ? settings.model
                  : t('A memória kezeléséhez nem kell modellt beállítani.')}
              </span>
            </div>
            <button
              className="icon-button"
              aria-label={t('Beállítások frissítése')}
              onClick={onRefresh}
            >
              <Icon name="refresh" size={16} />
            </button>
          </div>
          {!settings?.configured && (
            <div className="setup-guide">
              <div className="setup-guide-title">
                <span className="setup-number">01</span>
                <div>
                  <strong>{t('Nyisd meg a .env fájlt')}</strong>
                  <span>{t('A projekt gyökérmappájában találod.')}</span>
                </div>
              </div>
              <div className="setup-code">
                LLM_PROVIDER=openai-compatible
                <br />
                LLM_BASE_URL=https://api.openai.com/v1
                <br />
                LLM_API_KEY=illeszd-be-a-kulcsot
                <br />
                LLM_MODEL=gpt-4o-mini
              </div>
              <div className="setup-guide-title second">
                <span className="setup-number">02</span>
                <div>
                  <strong>{t('Indítsd újra az alkalmazást')}</strong>
                  <span>
                    <code>docker compose restart</code>
                    {t(' – a kulcs csak a szerveren tárolódik.')}
                  </span>
                </div>
              </div>
            </div>
          )}
        </article>

        <article className="settings-card privacy-card">
          <div className="settings-card-heading">
            <span className="settings-card-icon green">
              <Icon name="lock" size={18} />
            </span>
            <div>
              <span className="section-kicker">{t('ADATVÉDELEM')}</span>
              <h2>{t('Az emlékeid nálad maradnak.')}</h2>
            </div>
          </div>
          <p>
            {settings?.externalDataNotice
              ? t(settings.externalDataNotice)
              : t('A beállítások betöltése után látod, hová kerül a chat.')}
          </p>
          <div className="privacy-list">
            <div>
              <span className="privacy-check">
                <Icon name="check" size={14} />
              </span>
              <div>
                <strong>{t('Az emlékeid ezen a szerveren tárolódnak.')}</strong>
                <span>{t('Újraindításkor sem vesznek el.')}</span>
              </div>
              <span className="local-state">
                <Icon name="dot" size={11} />
                {t('HELYI')}
              </span>
            </div>
            <div>
              <span className="privacy-check">
                <Icon name="check" size={14} />
              </span>
              <div>
                <strong>{t('A chatelőzmény csak átmeneti.')}</strong>
                <span>{t('Az alkalmazás nem ment chatnaplót a lemezre.')}</span>
              </div>
            </div>
            <div>
              <span className="privacy-check">
                <Icon name="check" size={14} />
              </span>
              <div>
                <strong>{t('Az API-kulcs nem kerül a böngészőbe.')}</strong>
                <span>{t('Kizárólag a szerver futásidejű beállításából származik.')}</span>
              </div>
            </div>
          </div>
        </article>
      </div>

      <aside className="settings-aside">
        <article className="settings-card data-card">
          <span className="section-kicker">{t('A TE SAJÁT ADATAID')}</span>
          <div className="data-stat">
            <span>{memoryTotal.toString().padStart(2, '0')}</span>
            <Icon name="memory" size={22} />
          </div>
          <strong>{t('elmentett emlék')}</strong>
          <span className="data-footnote">{t('JSON-fájlban, saját tárhelyen')}</span>
          <div className="data-divider" />
          <div className="data-footnote-line">
            <Icon name="lock" size={13} />
            {t('Nem osztjuk meg senkivel.')}
          </div>
        </article>
        <article className="settings-card tips-card">
          <span className="section-kicker">{t('SAJÁT TÁRHELYED')}</span>
          <h3>{t('Te adod a kulcsot.')}</h3>
          <p>
            {t('A memóriafájl a')} <code>data/memories.json</code>
            {t(
              ' helyen van. Mentsd a teljes adatkönyvtárat, hogy a mentéseid is kézben maradjanak.',
            )}
          </p>
          <div className="local-tag">
            <Icon name="dot" size={11} />
            {t('TE IRÁNYÍTASZ')}
          </div>
        </article>
      </aside>
    </section>
  );
}
