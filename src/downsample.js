/**
 * Выборка отрезка [from, to] и прореживание до ~points точек.
 * Метод min/max по корзинам: в каждой корзине сохраняются минимум и максимум
 * каждого канала, поэтому пики не теряются (важно для анализа максимумов).
 */
function lowerBound(arr, x) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function upperBound(arr, x) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function sliceAndDownsample(time, seriesList, { from, to, points = 2000 } = {}) {
  const start = from === undefined || from === null ? 0 : Math.max(0, lowerBound(time, from) - 1);
  const endIdx =
    to === undefined || to === null ? time.length : Math.min(time.length, upperBound(time, to) + 1);
  const n = endIdx - start;
  const target = Math.max(100, Math.floor(points));

  if (n <= target) {
    return {
      time: time.slice(start, endIdx),
      series: seriesList.map((s) => s.slice(start, endIdx)),
      downsampled: false
    };
  }

  const buckets = Math.floor(target / 2);
  const size = n / buckets;
  const outT = [];
  const outS = seriesList.map(() => []);

  for (let b = 0; b < buckets; b++) {
    const i0 = start + Math.floor(b * size);
    const i1 = Math.min(endIdx, start + Math.floor((b + 1) * size));
    if (i1 <= i0) continue;
    const tA = time[i0];
    const tB = time[i1 - 1];
    outT.push(tA, tB === tA ? tA + 1e-6 : tB);
    seriesList.forEach((s, k) => {
      let min = null;
      let max = null;
      let minI = -1;
      let maxI = -1;
      for (let i = i0; i < i1; i++) {
        const v = s[i];
        if (v === null) continue;
        if (min === null || v < min) {
          min = v;
          minI = i;
        }
        if (max === null || v > max) {
          max = v;
          maxI = i;
        }
      }
      // сохраняем порядок появления min и max
      if (minI <= maxI) outS[k].push(min, max);
      else outS[k].push(max, min);
    });
  }

  return { time: outT, series: outS, downsampled: true };
}

module.exports = { sliceAndDownsample, lowerBound };
