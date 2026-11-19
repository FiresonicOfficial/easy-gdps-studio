import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Edit3,
  Info,
  Loader2,
  Save,
  Swords,
  Trash2,
} from 'lucide-react';
import {
  getGauntletCatalogForVersion,
  getGauntletNameById,
  type GdVersionId,
} from '@shared/gdVersions';
import type {
  GdpsGauntletRecord,
  GdpsLevelRecord,
  SaveGauntletPayload,
} from '@shared/types';

interface GauntletManagerSectionProps {
  serverId: string;
  version: GdVersionId;
  levels: GdpsLevelRecord[];
  gauntlets: GdpsGauntletRecord[];
  onChanged: () => Promise<void>;
  onRequestDelete: (gauntlet: GdpsGauntletRecord) => void;
}

export const GauntletManagerSection: React.FC<GauntletManagerSectionProps> = ({
  serverId,
  version,
  levels,
  gauntlets,
  onChanged,
  onRequestDelete,
}) => {
  const catalog = useMemo(() => getGauntletCatalogForVersion(version), [version]);

  const gauntletById = useMemo(() => {
    const map = new Map<number, GdpsGauntletRecord>();
    for (const g of gauntlets) {
      map.set(g.ID, g);
    }
    return map;
  }, [gauntlets]);

  const levelMap = useMemo(() => {
    const map = new Map<number, GdpsLevelRecord>();
    for (const lvl of levels) {
      map.set(lvl.levelID, lvl);
    }
    return map;
  }, [levels]);

  const [selectedSlotId, setSelectedSlotId] = useState<number>(() => catalog[0]?.id ?? 1);
  const [slotLevels, setSlotLevels] = useState<[string, string, string, string, string]>([
    '',
    '',
    '',
    '',
    '',
  ]);
  const [formError, setFormError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const formHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const slotSelectRef = useRef<HTMLSelectElement | null>(null);

  const sectionHeadingId = useId();
  const formHeadingId = useId();
  const slotSelectId = useId();
  const lvlIds = [useId(), useId(), useId(), useId(), useId()];

  // Ensure selectedSlotId stays valid if server version changes
  useEffect(() => {
    if (catalog.length > 0 && !catalog.some((c) => c.id === selectedSlotId)) {
      setSelectedSlotId(catalog[0].id);
    }
  }, [catalog, selectedSlotId]);

  const loadSlotIntoForm = (slotId: number) => {
    setSelectedSlotId(slotId);
    setFormError(null);
    const existing = gauntletById.get(slotId);
    if (existing) {
      setSlotLevels([
        existing.levels[0] ? String(existing.levels[0]) : '',
        existing.levels[1] ? String(existing.levels[1]) : '',
        existing.levels[2] ? String(existing.levels[2]) : '',
        existing.levels[3] ? String(existing.levels[3]) : '',
        existing.levels[4] ? String(existing.levels[4]) : '',
      ]);
    } else {
      setSlotLevels(['', '', '', '', '']);
    }
  };

  const handleEditGauntlet = (gauntlet: GdpsGauntletRecord) => {
    setStatusMessage(null);
    loadSlotIntoForm(gauntlet.ID);
    window.requestAnimationFrame(() => {
      formHeadingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      slotSelectRef.current?.focus();
    });
  };

  const handleLevelChange = (index: 0 | 1 | 2 | 3 | 4, value: string) => {
    setSlotLevels((prev) => {
      const next: [string, string, string, string, string] = [...prev];
      next[index] = value;
      return next;
    });
    if (formError) setFormError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setStatusMessage(null);

    if (!catalog.some((c) => c.id === selectedSlotId)) {
      setFormError(`Gauntlet slot #${selectedSlotId} is not supported on Geometry Dash ${version}.`);
      return;
    }

    const parsed = slotLevels.map((val) => Number(val));
    if (parsed.some((id) => !id || Number.isNaN(id))) {
      setFormError('Please select all 5 levels (Level 1 through Level 5) in progression order.');
      return;
    }

    if (new Set(parsed).size !== 5) {
      setFormError('All 5 levels in a Gauntlet must be unique (no duplicate levels).');
      return;
    }

    const payload: SaveGauntletPayload = {
      ID: selectedSlotId,
      level1: parsed[0],
      level2: parsed[1],
      level3: parsed[2],
      level4: parsed[3],
      level5: parsed[4],
    };

    setSaving(true);
    try {
      await window.easyGdps.adminSaveGauntlet(serverId, payload);
      await onChanged();
      const officialName = getGauntletNameById(selectedSlotId);
      setStatusMessage(
        `Saved ${officialName} (#${selectedSlotId}) with progression order ${parsed
          .map((id) => `#${id}`)
          .join(' → ')}.`
      );
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save Gauntlet.');
    } finally {
      setSaving(false);
    }
  };

  const isEditingExisting = gauntletById.has(selectedSlotId);
  const nonEmptySelected = slotLevels.filter(Boolean);
  const hasDuplicates = nonEmptySelected.length !== new Set(nonEmptySelected).size;
  const maxCatalogId = catalog[catalog.length - 1]?.id ?? 0;

  const sortedGauntlets = useMemo(
    () => [...gauntlets].sort((a, b) => a.ID - b.ID),
    [gauntlets]
  );

  return (
    <section
      aria-labelledby={sectionHeadingId}
      className="space-y-5 rounded-2xl border border-gd-border bg-gd-panel/90 p-5 shadow-lg shadow-black/25"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Swords className="h-5 w-5 text-gd-gold" aria-hidden="true" />
            <h2 id={sectionHeadingId} className="text-lg font-bold text-white">
              Gauntlets Manager ({gauntlets.length})
            </h2>
            <span className="rounded-md border border-gd-gold/40 bg-gd-gold/10 px-2 py-0.5 font-mono text-[11px] font-bold text-gd-gold">
              GD {version} Slots: 1–{maxCatalogId}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-slate-400">
            Configure official Geometry Dash {version} Gauntlets with 5 ordered levels.
          </p>
        </div>
      </div>

      {statusMessage && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-xl border border-gd-green/40 bg-gd-green/10 px-3.5 py-2.5 text-xs text-emerald-200"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0 text-gd-green" aria-hidden="true" />
          <span>{statusMessage}</span>
        </div>
      )}

      {/* Requirement Guard: Need at least 5 levels */}
      {levels.length < 5 ? (
        <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-5 text-center">
          <AlertTriangle className="mx-auto h-7 w-7 text-amber-300" aria-hidden="true" />
          <p className="mt-2 text-sm font-bold text-amber-100">
            Upload at least 5 levels to create a Gauntlet.
          </p>
          <p className="mt-1 text-xs text-amber-200/80">
            Currently uploaded: <strong className="font-mono">{levels.length}</strong> / 5 levels.
            Publish levels from your GDPS client and click <strong>Refresh Community Data</strong>.
          </p>
        </div>
      ) : (
        <form
          noValidate
          aria-labelledby={formHeadingId}
          onSubmit={handleSubmit}
          className="space-y-4 rounded-xl border border-gd-border bg-gd-bg/70 p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3
              id={formHeadingId}
              ref={formHeadingRef}
              tabIndex={-1}
              className="text-sm font-bold text-white focus:outline-none"
            >
              {isEditingExisting
                ? `Edit ${getGauntletNameById(selectedSlotId)} (#${selectedSlotId})`
                : 'Configure Gauntlet Slot'}
            </h3>
            {isEditingExisting && (
              <span className="rounded-md border border-gd-cyan/40 bg-gd-cyan/15 px-2 py-0.5 text-[11px] font-semibold text-gd-cyan">
                Editing Existing Slot (Saving overwrites levels)
              </span>
            )}
          </div>

          {formError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-xl border border-rose-500/45 bg-rose-500/15 px-3 py-2 text-xs text-rose-200"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" aria-hidden="true" />
              <span>{formError}</span>
            </div>
          )}

          {/* Gauntlet Slot Selector */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor={slotSelectId} className="text-xs font-semibold text-slate-200">
                Official Gauntlet Slot (GD {version}: #1 – #{maxCatalogId}){' '}
                <span aria-hidden="true" className="text-gd-gold">*</span>
              </label>
              <select
                ref={slotSelectRef}
                id={slotSelectId}
                name="gauntletSlotId"
                value={selectedSlotId}
                onChange={(e) => loadSlotIntoForm(Number(e.target.value))}
                className="rounded-xl border border-gd-border bg-gd-panel px-3 py-2 text-xs text-white focus:border-gd-gold focus:outline-none"
              >
                {catalog.map((entry) => {
                  const configured = gauntletById.has(entry.id);
                  return (
                    <option key={entry.id} value={entry.id}>
                      #{entry.id} — {entry.name}
                      {configured ? ' (Configured)' : ''}
                    </option>
                  );
                })}
              </select>
            </div>

            <div className="flex items-start gap-2 rounded-xl border border-gd-cyan/30 bg-gd-cyan/10 p-3 text-xs text-cyan-100">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-gd-cyan" aria-hidden="true" />
              <span>
                In-game Gauntlet progression strictly follows this exact{' '}
                <strong>Level 1 &rarr; Level 2 &rarr; Level 3 &rarr; Level 4 &rarr; Level 5</strong>{' '}
                order. Players unlock each stage sequentially by beating the previous level.
              </span>
            </div>
          </div>

          {/* 5 Ordered Level Selectors */}
          <fieldset className="space-y-2.5">
            <legend className="text-xs font-semibold text-slate-200">
              Ordered Gauntlet Levels (1 &rarr; 5 Progression){' '}
              <span aria-hidden="true" className="text-gd-gold">*</span>
            </legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {([0, 1, 2, 3, 4] as const).map((idx) => {
                const others = slotLevels.filter((_, i) => i !== idx && Boolean(slotLevels[i]));
                return (
                  <div key={idx} className="flex flex-col gap-1">
                    <label
                      htmlFor={lvlIds[idx]}
                      className="flex items-center justify-between text-[11px] font-semibold text-slate-300"
                    >
                      <span>Level {idx + 1}</span>
                      <span className="font-mono text-[10px] text-gd-gold">
                        {idx === 0 ? 'Start' : idx === 4 ? 'Final Boss' : `Stage ${idx + 1}`}
                      </span>
                    </label>
                    <select
                      id={lvlIds[idx]}
                      value={slotLevels[idx]}
                      onChange={(e) => handleLevelChange(idx, e.target.value)}
                      className="rounded-xl border border-gd-border bg-gd-panel px-2.5 py-2 text-xs text-white focus:border-gd-gold focus:outline-none"
                    >
                      <option value="">-- Pick Level {idx + 1} --</option>
                      {levels.map((lvl) => {
                        const idStr = String(lvl.levelID);
                        const pickedElsewhere = others.includes(idStr);
                        return (
                          <option key={lvl.levelID} value={idStr} disabled={pickedElsewhere}>
                            #{lvl.levelID} — {lvl.levelName}
                            {pickedElsewhere ? ' [Used]' : ''}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                );
              })}
            </div>
            {hasDuplicates && (
              <p role="alert" className="text-xs font-medium text-rose-400">
                Duplicate level detected. All 5 Gauntlet slots must use distinct levels.
              </p>
            )}
          </fieldset>

          <div className="flex justify-end pt-1">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-gd-gold to-amber-400 px-4 py-2 text-xs font-bold text-slate-950 shadow-md shadow-gd-gold/20 transition hover:brightness-110 disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              <span>
                {saving
                  ? 'Saving Gauntlet...'
                  : isEditingExisting
                    ? `Update ${getGauntletNameById(selectedSlotId)}`
                    : `Save ${getGauntletNameById(selectedSlotId)}`}
              </span>
            </button>
          </div>
        </form>
      )}

      {/* Configured Gauntlets List */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-slate-200">
          Configured Gauntlets ({sortedGauntlets.length})
        </h3>

        {sortedGauntlets.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gd-border p-6 text-center text-xs text-slate-400">
            No Gauntlets configured yet. Select an official slot above and assign 5 levels to enable
            it in-game.
          </div>
        ) : (
          <div className="space-y-3">
            {sortedGauntlets.map((gauntlet) => {
              const officialName = getGauntletNameById(gauntlet.ID);
              return (
                <article
                  key={gauntlet.ID}
                  className="rounded-xl border border-gd-border bg-gd-bg/80 p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span className="rounded-lg border border-gd-gold/40 bg-gd-gold/15 px-2 py-0.5 font-mono text-xs font-extrabold text-gd-gold">
                        #{gauntlet.ID}
                      </span>
                      <h4 className="text-sm font-bold text-white">{officialName}</h4>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleEditGauntlet(gauntlet)}
                        className="inline-flex items-center gap-1 rounded-lg border border-gd-cyan/40 bg-gd-cyan/10 px-2.5 py-1 text-xs font-semibold text-gd-cyan transition hover:bg-gd-cyan/20"
                      >
                        <Edit3 className="h-3 w-3" aria-hidden="true" />
                        <span>Edit</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onRequestDelete(gauntlet)}
                        aria-label={`Delete ${officialName}`}
                        className="inline-flex items-center gap-1 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/25"
                      >
                        <Trash2 className="h-3 w-3" aria-hidden="true" />
                        <span>Delete</span>
                      </button>
                    </div>
                  </div>

                  {/* Ordered 1 -> 5 Progression Strip */}
                  <ol className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
                    {gauntlet.levels.map((lvlId, idx) => {
                      const lvl = levelMap.get(lvlId);
                      return (
                        <React.Fragment key={`${gauntlet.ID}-stage-${idx}-${lvlId}`}>
                          <li
                            className="inline-flex max-w-[14rem] items-center gap-1.5 rounded-lg border border-gd-border/80 bg-gd-panel/80 px-2.5 py-1.5"
                            title={lvl ? `${lvl.levelName} (#${lvlId})` : `Level #${lvlId}`}
                          >
                            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-gd-gold/20 font-mono text-[10px] font-bold text-gd-gold">
                              {idx + 1}
                            </span>
                            <span className="truncate font-medium text-slate-100">
                              {lvl ? lvl.levelName : `Level #${lvlId}`}
                            </span>
                            <span className="shrink-0 font-mono text-[10px] text-slate-400">
                              #{lvlId}
                            </span>
                          </li>
                          {idx < gauntlet.levels.length - 1 && (
                            <ArrowRight
                              className="h-3.5 w-3.5 shrink-0 text-slate-500"
                              aria-hidden="true"
                            />
                          )}
                        </React.Fragment>
                      );
                    })}
                  </ol>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
};
