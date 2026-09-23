// Parses a generated script (see lib/scriptGenerator.js's output format)
// into ordered narration segments: [{ label, text }, ...]
//
// Expected script format:
// [훅]
// ...text...
//
// [본문]
// ...text...
//
// [반전 또는 결론]
// ...text...
//
// [CTA]
// ...text...

const SEGMENT_ORDER = ['훅', '본문', '반전 또는 결론', 'CTA'];

function parseScriptSegments(script) {
  if (typeof script !== 'string' || !script.trim()) {
    throw new Error('빈 대본은 세그먼트로 분리할 수 없습니다.');
  }

  const headerRegex = /^\s*\[(.+?)\]\s*$/gm;
  const matches = [...script.matchAll(headerRegex)];

  if (matches.length === 0) {
    throw new Error('대본에서 [훅]/[본문]/[반전 또는 결론]/[CTA] 형식의 섹션 헤더를 찾을 수 없습니다.');
  }

  const segments = matches.map((match, i) => {
    const label = match[1].trim();
    const start = match.index + match[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : script.length;
    const text = script.slice(start, end).trim();
    return { label, text };
  });

  const nonEmpty = segments.filter((seg) => seg.text.length > 0);

  if (nonEmpty.length === 0) {
    throw new Error('모든 세그먼트의 본문이 비어 있습니다.');
  }

  return nonEmpty;
}

module.exports = { SEGMENT_ORDER, parseScriptSegments };
