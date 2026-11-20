/** Iterative radix-2 FFT (Cooley–Tukey) mit eingebauter Bitumkehr. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t
      t = im[i]; im[i] = im[j]; im[j] = t
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang), wi = Math.sin(ang)
    const half = len >> 1
    for (let i = 0; i < n; i += len) {
      let cwr = 1, cwi = 0
      for (let j = 0; j < half; j++) {
        const ur = re[i + j], ui = im[i + j]
        const vr = re[i + j + half] * cwr - im[i + j + half] * cwi
        const vi = re[i + j + half] * cwi + im[i + j + half] * cwr
        re[i + j] = ur + vr; im[i + j] = ui + vi
        re[i + j + half] = ur - vr; im[i + j + half] = ui - vi
        const nwr = cwr * wr - cwi * wi
        cwi = cwr * wi + cwi * wr
        cwr = nwr
      }
    }
  }
}

/** Hann-Fenster in-place vorberechnet */
export function hannWindow(n: number): Float64Array {
  const w = new Float64Array(n)
  for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)))
  return w
}
