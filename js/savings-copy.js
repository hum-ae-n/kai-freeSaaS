/**
 * savings-copy.js: the single source of the hero's savings sentence.
 *
 * Why this file exists. The hero states the same figures twice: once in the
 * page js/public.js renders for a person, and once in the static crawler
 * block scripts/build-seo.mjs writes into index.html for a reader with no
 * JavaScript. Those were two hand-written copies of one sentence, and at
 * 17.3 they drifted: the rendered hero moved to fact tiles and dropped the
 * coffee equivalent, while the crawler block still told Google and every AI
 * crawler "roughly 2,900 coffees at £4 a cup". Nothing caught it. The
 * generator's drift gate only proves the generator agrees with ITSELF, and
 * the check that was meant to compare the two was specified but never built.
 *
 * So the sentence is computed in one place and imported by both. A test can
 * only catch drift after someone writes the test; a shared module makes the
 * drift impossible to express. Keep this file free of DOM and Node APIs so
 * both sides can import it unchanged.
 */

/** GBP, no decimals, thousands separated. The one formatter both sides use. */
export function formatGbp(amount) {
  return `£${Math.round(amount).toLocaleString('en-GB')}`;
}

/** Sum the `value` field over a list of tools, ignoring anything non-finite. */
export function sumValue(tools) {
  return tools.reduce((total, t) => total + (Number.isFinite(t.value) ? t.value : 0), 0);
}

/**
 * The hero's savings figures, derived from the active tool list alone.
 * `ceiling` is every active tool's value summed, which nobody adopts all of:
 * PRD section 10 calls a figure nobody would pay a bug the validator cannot
 * catch, so it must never be stated without its framing. `core` is what a
 * starter stack actually saves, and is the figure that leads.
 */
export function savingsFigures(activeTools) {
  const coreTools = activeTools.filter((t) => t.type === 'core');
  return {
    ceiling: sumValue(activeTools),
    core: sumValue(coreTools),
    coreCount: coreTools.length,
    activeCount: activeTools.length,
  };
}

/**
 * The canonical sentence, used verbatim as the accessible name of the hero
 * facts and as the crawler block's savings line. The ceiling only ever
 * appears after the realistic figure and inside its "if you used all N"
 * framing, which is the honesty rule made structural rather than editorial.
 */
export function savingsSentence(figures) {
  const { ceiling, core, coreCount, activeCount } = figures;
  return `A starter stack of ${coreCount} tools saves ${formatGbp(core)} a year. `
    + `If you used all ${activeCount} tools the ceiling is ${formatGbp(ceiling)} a year. `
    + `${activeCount} tools listed, and zero paid placements.`;
}
