// Partes puras da voz (sem Electron): limpar a transcrição, achar a palavra de ativação e conferir o áudio recebido.

/** Minúsculas e sem acento, para comparar o que o Whisper escreveu com o que esperamos. */
export const normalizar = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Tira o que o Whisper escreve quando não ouve fala: [BLANK_AUDIO], (música), [Music], "..." etc. */
export function limparTranscricao(bruto: string): string {
  return bruto
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\((?:música|musica|music|ruído|ruido|silêncio|silencio|aplausos|risos|noise)[^)]*\)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function distancia(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)])
  for (let j = 0; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}

const SAUDACOES = new Set(['ei', 'hey', 'oi', 'ola', 'e', 'ai', 'ok', 'okay'])
const SOA_COMO_MEMORIX = (p: string): boolean => p === 'memoritrix' || (/^memor/.test(p) && /(x|ks|cs|cx)$/.test(p) && distancia(p, 'memorix') <= 3)

/**
 * Se a fala começa com a palavra de ativação ("Memorix", "ei Memorix", "oi, Memorix"), devolve o que vem depois (pode ser '').
 * Se não começa, devolve null (a fala é ignorada). Aceita grafias próximas, porque o Whisper escreve "Memóriks", "Memorics" etc.
 */
export function extrairComando(texto: string): string | null {
  const limpo = limparTranscricao(texto)
  const palavras = limpo.split(/\s+/).filter(Boolean)
  for (let i = 0; i < Math.min(palavras.length, 3); i++) {
    const p = normalizar(palavras[i]).replace(/[^a-z]/g, '')
    if (i < 2 && SAUDACOES.has(p)) continue
    if (SOA_COMO_MEMORIX(p)) return palavras.slice(i + 1).join(' ').replace(/^[,.:;!?\s-]+/, '').trim()
    return null
  }
  return null
}

export const MAX_AUDIO = 12 * 1024 * 1024 // ~6 min de áudio 16 kHz mono de 16 bits; o app grava no máximo 60 s

/** Confere se os bytes são mesmo um WAV PCM pequeno antes de gravar em disco ou enviar. */
export function wavValido(b: Uint8Array): boolean {
  if (b.length < 44 || b.length > MAX_AUDIO) return false
  const t = (i: number): string => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3])
  return t(0) === 'RIFF' && t(8) === 'WAVE'
}

export interface ConfigVoz { motor: 'local' | 'nuvem'; palavra: boolean; modeloNuvem: string }
export const VOZ_PADRAO: ConfigVoz = { motor: 'local', palavra: false, modeloNuvem: 'whisper-1' }

/** Aceita só valores conhecidos; qualquer outra coisa volta ao padrão. */
export function configVoz(bruto: unknown): ConfigVoz {
  const o = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>
  const modelo = typeof o.modeloNuvem === 'string' && /^[\w./:-]{1,80}$/.test(o.modeloNuvem) ? o.modeloNuvem : VOZ_PADRAO.modeloNuvem
  return { motor: o.motor === 'nuvem' ? 'nuvem' : 'local', palavra: o.palavra === true, modeloNuvem: modelo }
}
