import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { api } from './api/client.js';
import { useI18n } from './i18n.js';

export type MemoryTransferMode = 'import' | 'export';

export function MemoryTransferDialog({
  mode,
  onClose,
  onImported,
}: {
  mode: MemoryTransferMode;
  onClose: () => void;
  onImported: (result: { imported: number; skipped: number }) => Promise<void> | void;
}) {
  const { t } = useI18n();
  const [exportText, setExportText] = useState('');
  const [importText, setImportText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (mode !== 'export') return;
    let active = true;
    setBusy(true);
    api
      .exportMemories()
      .then((document) => {
        if (active) setExportText(JSON.stringify(document, null, 2));
      })
      .catch((failure: unknown) => {
        if (active)
          setError(
            failure instanceof Error ? failure.message : t('Az exportálás nem sikerült.'),
          );
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [mode, t]);

  async function readFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;
    setError('');
    setNotice('');
    try {
      setImportText(await file.text());
    } catch {
      setError(t('A kiválasztott fájlt nem sikerült beolvasni.'));
    }
    event.target.value = '';
  }

  async function importFile(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || !importText.trim()) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      let document: unknown;
      try {
        document = JSON.parse(importText) as unknown;
      } catch {
        throw new Error(t('A bemásolt szöveg nem érvényes JSON.'));
      }
      const result = await api.importMemories(document);
      await onImported(result);
      onClose();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : t('Az importálás nem sikerült. Ellenőrizd a fájl tartalmát.'),
      );
    } finally {
      setBusy(false);
    }
  }

  async function copyExport(): Promise<void> {
    if (!exportText) return;
    setError('');
    setNotice('');
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(exportText);
      } else {
        const textarea = document.querySelector<HTMLTextAreaElement>('.transfer-textarea');
        textarea?.select();
        if (!textarea || !document.execCommand('copy')) throw new Error('copy_failed');
      }
      setNotice(t('Az exportot a vágólapra másoltuk.'));
    } catch {
      setError(t('A másolás nem sikerült. Jelöld ki és másold ki a szöveget.'));
    }
  }

  function downloadExport(): void {
    if (!exportText) return;
    const blob = new Blob([exportText], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'home-memory-agent-memories.json';
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setNotice(t('Az exportfájl letöltése elindult.'));
  }

  const example = JSON.stringify(
    {
      format: 'home-memory-agent',
      version: 1,
      memories: [
        {
          category: 'Travel',
          content: 'I prefer quiet places close to nature.',
          priority: 'normal',
        },
      ],
    },
    null,
    2,
  );

  return (
    <div
      className="transfer-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        className="transfer-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="memory-transfer-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) onClose();
        }}
      >
        <header className="transfer-dialog-header">
          <div>
            <div className="section-kicker">{t('A TE PRIVÁT TÁRAD')}</div>
            <h2 id="memory-transfer-title">
              {t(mode === 'import' ? 'Memóriák importálása' : 'Memóriák exportálása')}
            </h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label={t('Bezárás')}
            onClick={onClose}
            disabled={busy}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>

        {mode === 'import' ? (
          <form onSubmit={(event) => void importFile(event)}>
            <p className="transfer-description">
              {t(
                'Tölts fel egy JSON-fájlt, vagy illeszd be az emlékeidet a megadott formátumban.',
              )}
            </p>
            <label className="button button-quiet transfer-file-button">
              {t('JSON-fájl kiválasztása')}
              <input
                type="file"
                accept=".json,application/json"
                onChange={(event) => void readFile(event)}
              />
            </label>
            <label className="transfer-label" htmlFor="memory-import-json">
              {t('Vagy illeszd be a JSON-t')}
            </label>
            <textarea
              id="memory-import-json"
              className="transfer-textarea"
              aria-label={t('Vagy illeszd be a JSON-t')}
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              spellCheck={false}
              placeholder={example}
            />
            <details className="transfer-format-help">
              <summary>{t('Megnézem a támogatott JSON-formátumot')}</summary>
              <pre>{example}</pre>
              <p>
                {t(
                  'A kategória és a szöveg kötelező. A prioritás, lejárat és archiválás opcionális.',
                )}
              </p>
            </details>
            <p className="transfer-description transfer-privacy-note">
              {t(
                'Az import legfeljebb 500 emléket kezel egyszerre. A meglévő egyezéseket kihagyjuk.',
              )}
            </p>
            <TransferFeedback error={error} notice={notice} />
            <footer className="transfer-dialog-footer">
              <button
                className="button button-quiet"
                type="button"
                onClick={onClose}
                disabled={busy}
              >
                {t('Mégse')}
              </button>
              <button
                className="button button-primary"
                type="submit"
                disabled={busy || !importText.trim()}
              >
                {busy ? t('Feldolgozás…') : t('Memóriák importálása')}
              </button>
            </footer>
          </form>
        ) : (
          <div>
            <p className="transfer-description">
              {t('A teljes memórialistát JSON-formátumban másolhatod vagy töltheted le.')}
            </p>
            {busy && !exportText ? (
              <div className="empty-state transfer-loading">
                <div className="spinner" />
                <p>{t('Betöltés…')}</p>
              </div>
            ) : (
              <>
                <label className="transfer-label" htmlFor="memory-export-json">
                  {t('Exportált memóriák JSON-formátuma')}
                </label>
                <textarea
                  id="memory-export-json"
                  className="transfer-textarea transfer-export-textarea"
                  aria-label={t('Exportált memóriák JSON-formátuma')}
                  value={exportText}
                  readOnly
                  spellCheck={false}
                />
              </>
            )}
            <TransferFeedback error={error} notice={notice} />
            <footer className="transfer-dialog-footer">
              <button className="button button-quiet" type="button" onClick={onClose}>
                {t('Bezárás')}
              </button>
              <button
                className="button button-quiet"
                type="button"
                onClick={() => void copyExport()}
                disabled={!exportText || busy}
              >
                {t('Másolás')}
              </button>
              <button
                className="button button-primary"
                type="button"
                onClick={downloadExport}
                disabled={!exportText || busy}
              >
                {t('Letöltés JSON-ként')}
              </button>
            </footer>
          </div>
        )}
      </section>
    </div>
  );
}

function TransferFeedback({ error, notice }: { error: string; notice: string }) {
  return (
    <>
      {error && (
        <div className="transfer-feedback error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="transfer-feedback" role="status">
          {notice}
        </div>
      )}
    </>
  );
}
