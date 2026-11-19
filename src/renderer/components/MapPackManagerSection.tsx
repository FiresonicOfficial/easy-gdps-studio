import React, { useId, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Coins,
  Edit3,
  Loader2,
  Map as MapIcon,
  Palette,
  Plus,
  Sparkles,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { MAPPACK_DIFFICULTIES } from '@shared/gdVersions';
import type { GdpsLevelRecord, GdpsMapPackRecord, SaveMapPackPayload } from '@shared/types';
import {
  hexToRgbString,
  isValidRgbString,
  rgbStringToHex,
  toCssRgb,
} from './uiHelpers';

interface MapPackManagerSectionProps {
  serverId: string;
  levels: GdpsLevelRecord[];
  mapPacks: GdpsMapPackRecord[];
  onChanged: () => Promise<void>;
  onRequestDelete: (pack: GdpsMapPackRecord) => void;
}

export const MapPackManagerSection: React.FC<MapPackManagerSectionProps> = ({
  serverId,
  levels,
  mapPacks,
  onChanged,
  onRequestDelete,
}) => {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [level1, setLevel1] = useState<string>('');
  const [level2, setLevel2] = useState<string>('');
  const [level3, setLevel3] = useState<string>('');
  const [stars, setStars] = useState<number>(3);
  const [coins, setCoins] = useState<number>(1);
  const [difficulty, setDifficulty] = useState<number>(2);
  const [rgbcolors, setRgbcolors] = useState<string>('255,255,255');
  const [colors2, setColors2] = useState<string>('56,242,110');

  const [formError, setFormError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const formHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  const sectionHeadingId = useId();
  const formHeadingId = useId();
  const nameId = useId();
  const nameHelpId = useId();
  const lvl1Id = useId();
  const lvl2Id = useId();
  const lvl3Id = useId();
  const starsId = useId();
  const difficultyId = useId();
  const textRgbId = useId();
  const textPickerId = useId();
  const barRgbId = useId();
  const barPickerId = useId();

  const levelMap = useMemo(() => {
    const map = new Map<number, GdpsLevelRecord>();
    for (const lvl of levels) {
      map.set(lvl.levelID, lvl);
    }
    return map;
  }, [levels]);

  const selectedDifficultyOption = useMemo(
    () => MAPPACK_DIFFICULTIES.find((d) => d.value === difficulty) ?? MAPPACK_DIFFICULTIES[2],
    [difficulty]
  );

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setLevel1('');
    setLevel2('');
    setLevel3('');
    setStars(3);
    setCoins(1);
    setDifficulty(2);
    setRgbcolors('255,255,255');
    setColors2('56,242,110');
    setFormError(null);
  };

  const handleStartEdit = (pack: GdpsMapPackRecord) => {
    setEditingId(pack.ID);
    setName(pack.name);
    setLevel1(pack.levels[0] ? String(pack.levels[0]) : '');
    setLevel2(pack.levels[1] ? String(pack.levels[1]) : '');
    setLevel3(pack.levels[2] ? String(pack.levels[2]) : '');
    setStars(Math.min(10, Math.max(1, pack.stars || 1)));
    setCoins(pack.coins === 2 ? 2 : 1);
    setDifficulty(pack.difficulty ?? 2);
    setRgbcolors(pack.rgbcolors || '255,255,255');
    setColors2(pack.colors2 || '56,242,110');
    setFormError(null);
    setStatusMessage(null);
    window.requestAnimationFrame(() => {
      formHeadingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      nameInputRef.current?.focus();
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setStatusMessage(null);

    const trimmedName = name.trim();
    if (trimmedName.length < 2 || trimmedName.length > 40) {
      setFormError('Pack Name must be between 2 and 40 characters.');
      nameInputRef.current?.focus();
      return;
    }

    const id1 = Number(level1);
    const id2 = Number(level2);
    const id3 = Number(level3);

    if (!id1 || !id2 || !id3) {
      setFormError('Please select 3 levels for this Map Pack.');
      return;
    }

    if (new Set([id1, id2, id3]).size !== 3) {
      setFormError('All 3 levels in a Map Pack must be unique (no duplicate levels).');
      return;
    }

    if (!isValidRgbString(rgbcolors)) {
      setFormError('Text Color RGB must use R,G,B format with values from 0 to 255 (e.g. 255,255,255).');
      return;
    }

    if (!isValidRgbString(colors2)) {
      setFormError('Bar Color RGB must use R,G,B format with values from 0 to 255 (e.g. 0,224,255).');
      return;
    }

    const payload: SaveMapPackPayload = {
      ...(editingId !== null ? { ID: editingId } : {}),
      name: trimmedName,
      levels: [id1, id2, id3],
      stars: Math.min(10, Math.max(1, stars)),
      coins: coins === 2 ? 2 : 1,
      difficulty,
      rgbcolors: rgbcolors
        .split(',')
        .map((c) => String(Number(c.trim())))
        .join(','),
      colors2: colors2
        .split(',')
        .map((c) => String(Number(c.trim())))
        .join(','),
    };

    setSaving(true);
    try {
      await window.easyGdps.adminSaveMapPack(serverId, payload);
      await onChanged();
      const actionLabel = editingId !== null ? `Updated Map Pack #${editingId}` : 'Created Map Pack';
      resetForm();
      setStatusMessage(`${actionLabel} "${trimmedName}" successfully.`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save Map Pack.');
    } finally {
      setSaving(false);
    }
  };

  const selectedIds = [level1, level2, level3].filter(Boolean);
  const hasDuplicateLevels = selectedIds.length !== new Set(selectedIds).size;

  const previewTextCss = toCssRgb(rgbcolors, 'rgb(255, 255, 255)');
  const previewBarCss = toCssRgb(colors2, 'rgb(56, 242, 110)');

  const resolveLevelLabel = (idStr: string) => {
    const id = Number(idStr);
    if (!id) return 'Not selected';
    const found = levelMap.get(id);
    return found ? `${found.levelName} (#${found.levelID})` : `Level #${id}`;
  };

  return (
    <section
      aria-labelledby={sectionHeadingId}
      className="space-y-5 rounded-2xl border border-gd-border bg-gd-panel/90 p-5 shadow-lg shadow-black/25"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <MapIcon className="h-5 w-5 text-gd-green" aria-hidden="true" />
            <h2 id={sectionHeadingId} className="text-lg font-bold text-white">
              Map Packs Manager ({mapPacks.length})
            </h2>
          </div>
          <p className="mt-0.5 text-xs text-slate-400">
            Bundle 3 uploaded levels into a curated Map Pack with custom star rewards, secret
            coins, difficulty badge, and RGB title/bar styling.
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

      {/* Requirement Guard: Need at least 3 levels */}
      {levels.length < 3 && editingId === null ? (
        <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-5 text-center">
          <AlertTriangle className="mx-auto h-7 w-7 text-amber-300" aria-hidden="true" />
          <p className="mt-2 text-sm font-bold text-amber-100">
            Upload at least 3 levels to create a Map Pack.
          </p>
          <p className="mt-1 text-xs text-amber-200/80">
            Currently uploaded: <strong className="font-mono">{levels.length}</strong> / 3 levels.
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
              {editingId !== null ? `Edit Map Pack #${editingId}` : 'Create New Map Pack'}
            </h3>
            {editingId !== null && (
              <button
                type="button"
                onClick={resetForm}
                className="inline-flex items-center gap-1 rounded-lg border border-gd-border bg-gd-panel px-2.5 py-1 text-xs font-semibold text-slate-300 hover:text-white"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Cancel Edit</span>
              </button>
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

          {/* Name, Difficulty, Stars, Coins */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
            <div className="flex flex-col gap-1 md:col-span-5">
              <label htmlFor={nameId} className="text-xs font-semibold text-slate-200">
                Pack Name <span aria-hidden="true" className="text-gd-green">*</span>
              </label>
              <input
                ref={nameInputRef}
                id={nameId}
                name="packName"
                type="text"
                required
                minLength={2}
                maxLength={40}
                value={name}
                aria-describedby={nameHelpId}
                onChange={(e) => {
                  setName(e.target.value);
                  if (formError) setFormError(null);
                }}
                placeholder="e.g. Neon Alpha Pack"
                className="rounded-xl border border-gd-border bg-gd-panel px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-gd-cyan focus:outline-none"
              />
              <span id={nameHelpId} className="text-[11px] text-slate-400">
                2–40 characters. Displayed in-game above the 3 levels.
              </span>
            </div>

            <div className="flex flex-col gap-1 md:col-span-3">
              <label htmlFor={difficultyId} className="text-xs font-semibold text-slate-200">
                Difficulty
              </label>
              <select
                id={difficultyId}
                name="difficulty"
                value={difficulty}
                onChange={(e) => {
                  const nextDiff = Number(e.target.value);
                  setDifficulty(nextDiff);
                }}
                className="rounded-xl border border-gd-border bg-gd-panel px-3 py-2 text-xs text-white focus:border-gd-cyan focus:outline-none"
              >
                {MAPPACK_DIFFICULTIES.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1 md:col-span-2">
              <label htmlFor={starsId} className="text-xs font-semibold text-slate-200">
                Stars (1–10)
              </label>
              <select
                id={starsId}
                name="stars"
                value={stars}
                onChange={(e) => setStars(Number(e.target.value))}
                className="rounded-xl border border-gd-border bg-gd-panel px-3 py-2 font-mono text-xs text-white focus:border-gd-cyan focus:outline-none"
              >
                {Array.from({ length: 10 }, (_, idx) => idx + 1).map((n) => (
                  <option key={n} value={n}>
                    {n} ★
                  </option>
                ))}
              </select>
            </div>

            <fieldset className="flex flex-col gap-1 md:col-span-2">
              <legend className="text-xs font-semibold text-slate-200">Secret Coins</legend>
              <div className="mt-1 flex gap-2">
                {[1, 2].map((coinCount) => (
                  <label
                    key={coinCount}
                    className={`flex flex-1 cursor-pointer items-center justify-center gap-1 rounded-xl border px-2 py-1.5 text-xs font-bold transition ${
                      coins === coinCount
                        ? 'border-gd-gold bg-gd-gold/15 text-gd-gold'
                        : 'border-gd-border bg-gd-panel text-slate-300 hover:border-slate-500'
                    }`}
                  >
                    <input
                      type="radio"
                      name="mapPackCoins"
                      value={coinCount}
                      checked={coins === coinCount}
                      onChange={() => setCoins(coinCount)}
                      className="visually-hidden"
                    />
                    <Coins className="h-3 w-3" aria-hidden="true" />
                    <span>{coinCount}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

          {/* 3 Level Selectors */}
          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold text-slate-200">
              Select 3 Unique Levels <span aria-hidden="true" className="text-gd-green">*</span>
            </legend>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {(
                [
                  { id: lvl1Id, label: 'Level 1', value: level1, setter: setLevel1, others: [level2, level3] },
                  { id: lvl2Id, label: 'Level 2', value: level2, setter: setLevel2, others: [level1, level3] },
                  { id: lvl3Id, label: 'Level 3', value: level3, setter: setLevel3, others: [level1, level2] },
                ] as const
              ).map((slot) => (
                <div key={slot.label} className="flex flex-col gap-1">
                  <label htmlFor={slot.id} className="text-[11px] font-medium text-slate-400">
                    {slot.label}
                  </label>
                  <select
                    id={slot.id}
                    value={slot.value}
                    onChange={(e) => {
                      slot.setter(e.target.value);
                      if (formError) setFormError(null);
                    }}
                    className="rounded-xl border border-gd-border bg-gd-panel px-3 py-2 text-xs text-white focus:border-gd-cyan focus:outline-none"
                  >
                    <option value="">-- Select {slot.label} --</option>
                    {levels.map((lvl) => {
                      const idStr = String(lvl.levelID);
                      const pickedElsewhere = slot.others.includes(idStr);
                      return (
                        <option key={lvl.levelID} value={idStr} disabled={pickedElsewhere}>
                          #{lvl.levelID} — {lvl.levelName} ({lvl.userName || `User #${lvl.userID}`})
                          {pickedElsewhere ? ' [Already selected]' : ''}
                        </option>
                      );
                    })}
                  </select>
                </div>
              ))}
            </div>
            {hasDuplicateLevels && (
              <p role="alert" className="text-xs font-medium text-rose-400">
                Duplicate level detected. Each slot must use a different level.
              </p>
            )}
          </fieldset>

          {/* RGB Colors + Live Styled Preview Badge */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            {/* Text Color RGB */}
            <div className="flex flex-col gap-1.5 lg:col-span-4">
              <label htmlFor={textRgbId} className="text-xs font-semibold text-slate-200">
                Text Color RGB (<code className="font-mono text-slate-400">rgbcolors</code>)
              </label>
              <div className="flex items-center gap-2">
                <label htmlFor={textPickerId} className="visually-hidden">
                  Pick text color
                </label>
                <input
                  id={textPickerId}
                  type="color"
                  value={rgbStringToHex(rgbcolors, '#ffffff')}
                  onChange={(e) => {
                    setRgbcolors(hexToRgbString(e.target.value));
                    if (formError) setFormError(null);
                  }}
                  className="h-9 w-11 cursor-pointer rounded-lg border border-gd-border bg-gd-panel p-1"
                />
                <input
                  id={textRgbId}
                  name="rgbcolors"
                  type="text"
                  value={rgbcolors}
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  onChange={(e) => {
                    setRgbcolors(e.target.value);
                    if (formError) setFormError(null);
                  }}
                  placeholder="255,255,255"
                  className="flex-1 rounded-xl border border-gd-border bg-gd-panel px-3 py-2 font-mono text-xs text-white focus:border-gd-cyan focus:outline-none"
                />
              </div>
            </div>

            {/* Bar Color RGB */}
            <div className="flex flex-col gap-1.5 lg:col-span-4">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor={barRgbId} className="text-xs font-semibold text-slate-200">
                  Bar Color RGB (<code className="font-mono text-slate-400">colors2</code>)
                </label>
                <button
                  type="button"
                  onClick={() => setColors2(selectedDifficultyOption.defaultColor)}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-gd-cyan hover:underline"
                >
                  <Palette className="h-3 w-3" aria-hidden="true" />
                  <span>Match {selectedDifficultyOption.label}</span>
                </button>
              </div>
              <div className="flex items-center gap-2">
                <label htmlFor={barPickerId} className="visually-hidden">
                  Pick bar color
                </label>
                <input
                  id={barPickerId}
                  type="color"
                  value={rgbStringToHex(colors2, '#38f26e')}
                  onChange={(e) => {
                    setColors2(hexToRgbString(e.target.value));
                    if (formError) setFormError(null);
                  }}
                  className="h-9 w-11 cursor-pointer rounded-lg border border-gd-border bg-gd-panel p-1"
                />
                <input
                  id={barRgbId}
                  name="colors2"
                  type="text"
                  value={colors2}
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  onChange={(e) => {
                    setColors2(e.target.value);
                    if (formError) setFormError(null);
                  }}
                  placeholder="56,242,110"
                  className="flex-1 rounded-xl border border-gd-border bg-gd-panel px-3 py-2 font-mono text-xs text-white focus:border-gd-cyan focus:outline-none"
                />
              </div>
            </div>

            {/* Live Preview Badge */}
            <div className="flex flex-col justify-between rounded-xl border border-gd-border bg-[#070b17] p-3 lg:col-span-4">
              <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                <span className="inline-flex items-center gap-1">
                  <Sparkles className="h-3 w-3 text-gd-cyan" aria-hidden="true" />
                  <span>Live In-Game Preview</span>
                </span>
                <span>{selectedDifficultyOption.label}</span>
              </div>

              <div className="mt-2 flex items-center justify-between gap-2">
                <span
                  className="truncate text-sm font-extrabold tracking-wide drop-shadow"
                  style={{ color: previewTextCss }}
                >
                  {name.trim() || 'Untitled Map Pack'}
                </span>
                <div className="flex shrink-0 items-center gap-1.5 font-mono text-[11px] font-bold">
                  <span className="inline-flex items-center gap-0.5 text-gd-gold">
                    <Star className="h-3 w-3 fill-current" aria-hidden="true" />
                    {stars}
                  </span>
                  <span className="inline-flex items-center gap-0.5 text-amber-300">
                    <Coins className="h-3 w-3" aria-hidden="true" />
                    {coins}
                  </span>
                </div>
              </div>

              <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full w-2/3 rounded-full transition-colors"
                  style={{ backgroundColor: previewBarCss }}
                />
              </div>
              <div className="mt-1.5 truncate text-[10px] text-slate-400">
                {resolveLevelLabel(level1)} &bull; {resolveLevelLabel(level2)} &bull;{' '}
                {resolveLevelLabel(level3)}
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            {editingId !== null && (
              <button
                type="button"
                onClick={resetForm}
                className="rounded-xl border border-gd-border bg-gd-panel px-4 py-2 text-xs font-semibold text-slate-300 hover:text-white"
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-gd-green to-emerald-400 px-4 py-2 text-xs font-bold text-slate-950 shadow-md shadow-gd-green/20 transition hover:brightness-110 disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Plus className="h-3.5 w-3.5 stroke-[2.5]" aria-hidden="true" />
              )}
              <span>
                {saving
                  ? 'Saving Map Pack...'
                  : editingId !== null
                    ? 'Save Map Pack Changes'
                    : 'Create Map Pack'}
              </span>
            </button>
          </div>
        </form>
      )}

      {/* Existing Map Packs List */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-slate-200">
          Existing Map Packs ({mapPacks.length})
        </h3>

        {mapPacks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gd-border p-6 text-center text-xs text-slate-400">
            No Map Packs created yet. Create one above to appear in Geometry Dash&apos;s Map Packs
            tab.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {mapPacks.map((pack) => {
              const diffObj =
                MAPPACK_DIFFICULTIES.find((d) => d.value === pack.difficulty) ??
                MAPPACK_DIFFICULTIES[2];
              const txtCss = toCssRgb(pack.rgbcolors, 'rgb(255, 255, 255)');
              const barCss = toCssRgb(pack.colors2, 'rgb(56, 242, 110)');

              return (
                <article
                  key={pack.ID}
                  className="flex flex-col justify-between rounded-xl border border-gd-border bg-gd-bg/80 p-4"
                >
                  <div>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-gd-panel px-1.5 py-0.5 font-mono text-[11px] font-bold text-slate-400">
                            #{pack.ID}
                          </span>
                          <h4
                            className="truncate text-sm font-extrabold"
                            style={{ color: txtCss }}
                          >
                            {pack.name}
                          </h4>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
                          <span className="rounded border border-gd-border bg-gd-panel px-2 py-0.5 font-semibold text-slate-200">
                            {diffObj.label}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded border border-gd-gold/40 bg-gd-gold/10 px-2 py-0.5 font-mono font-bold text-gd-gold">
                            <Star className="h-3 w-3 fill-current" aria-hidden="true" />
                            {pack.stars} ★
                          </span>
                          <span className="inline-flex items-center gap-1 rounded border border-amber-400/35 bg-amber-400/10 px-2 py-0.5 font-mono font-bold text-amber-200">
                            <Coins className="h-3 w-3" aria-hidden="true" />
                            {pack.coins} {pack.coins === 1 ? 'Coin' : 'Coins'}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleStartEdit(pack)}
                          className="inline-flex items-center gap-1 rounded-lg border border-gd-cyan/40 bg-gd-cyan/10 px-2.5 py-1 text-xs font-semibold text-gd-cyan transition hover:bg-gd-cyan/20"
                        >
                          <Edit3 className="h-3 w-3" aria-hidden="true" />
                          <span>Edit</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onRequestDelete(pack)}
                          aria-label={`Delete Map Pack ${pack.name}`}
                          className="inline-flex items-center gap-1 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/25"
                        >
                          <Trash2 className="h-3 w-3" aria-hidden="true" />
                          <span>Delete</span>
                        </button>
                      </div>
                    </div>

                    {/* Bar Preview + RGB Values */}
                    <div className="mt-3 space-y-1.5">
                      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                        <div className="h-full w-full rounded-full" style={{ backgroundColor: barCss }} />
                      </div>
                      <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] text-slate-400">
                        <span className="inline-flex items-center gap-1">
                          <span
                            className="inline-block h-2.5 w-2.5 rounded-full border border-white/25"
                            style={{ backgroundColor: txtCss }}
                            aria-hidden="true"
                          />
                          Text: {pack.rgbcolors}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <span
                            className="inline-block h-2.5 w-2.5 rounded-full border border-white/25"
                            style={{ backgroundColor: barCss }}
                            aria-hidden="true"
                          />
                          Bar: {pack.colors2}
                        </span>
                      </div>
                    </div>

                    {/* 3 Levels */}
                    <ol className="mt-3 grid grid-cols-1 gap-1.5 border-t border-gd-border/60 pt-2.5 text-xs sm:grid-cols-3">
                      {pack.levels.map((lvlId, i) => {
                        const lvl = levelMap.get(lvlId);
                        return (
                          <li
                            key={`${pack.ID}-lvl-${i}-${lvlId}`}
                            className="truncate rounded-lg border border-gd-border/70 bg-gd-panel/70 px-2.5 py-1.5 text-slate-200"
                            title={lvl ? `${lvl.levelName} (#${lvlId})` : `Level #${lvlId}`}
                          >
                            <span className="mr-1 font-mono text-[10px] text-gd-cyan">
                              {i + 1}.
                            </span>
                            {lvl ? lvl.levelName : `Level #${lvlId}`}{' '}
                            <span className="font-mono text-[10px] text-slate-400">#{lvlId}</span>
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
};
