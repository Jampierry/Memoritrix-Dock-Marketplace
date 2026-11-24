// Indexador da Sinapse: transforma notas e arquivos escolhidos pelo usuário em nós e ligações.
// Lógica pura (sem Electron e sem disco), para ser testável. Nada aqui sai do computador.

export interface NotaBruta { caminho: string; texto: string; tamanho: number; alterado: number }
export interface NotaIndexada {
  id: string // caminho normalizado (barras "/")
  titulo: string
  pasta: string
  links: string[] // alvos de [[wikilinks]], em minúsculas
  tags: string[]
  termos: Record<string, number> // palavra -> peso (frequência normalizada)
  resumo: string
  tamanho: number
  alterado: number
}
export type TipoLigacao = 'link' | 'pasta' | 'tag' | 'similar'
export interface NoSinapse { id: string; titulo: string; pasta: string; peso: number; tags: string[]; resumo: string }
export interface LigacaoSinapse { origem: string; destino: string; tipo: TipoLigacao; forca: number }
export interface GrafoSinapse { nos: NoSinapse[]; ligacoes: LigacaoSinapse[] }

export const EXT_TEXTO = ['.md', '.markdown', '.txt'] as const
export const PASTAS_IGNORADAS = new Set(['node_modules', '.git', '.svn', '.hg', 'dist', 'out', 'build', '.next', '.cache', '$recycle.bin', 'system volume information', 'appdata', 'windows', 'program files', 'program files (x86)'])
export const LIMITE_BYTES = 512 * 1024 // arquivos maiores só entram pelo nome
export const LIMITE_NOTAS = 3000

const PARADAS = new Set(('a o as os um uma uns umas de do da dos das em no na nos nas por para com sem sob sobre entre e ou mas que se como mais menos muito muita já não sim ao aos à às é são foi ser ter tem há isso isto esse essa este esta aquele aquela seu sua seus suas meu minha nosso nossa the of and to in is it for on with as at by an be this that from or are was not')
  .split(' '))

/** Eventos do vigia que não valem um novo aprendizado: pastas ocultas ou ignoradas e arquivos temporários. */
export function deveIgnorarEvento(relativo: string): boolean {
  const seg = relativo.split(/[\\/]/).filter(Boolean)
  if (!seg.length) return false
  return seg.some((s) => s.startsWith('.') || PASTAS_IGNORADAS.has(s.toLowerCase())) || /(\.(tmp|swp|crdownload|part)|~)$/i.test(seg[seg.length - 1])
}

export const normalizarCaminho = (c: string): string => c.replace(/\\/g, '/')
const semAcento = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Palavras úteis do texto (minúsculas, sem acento, sem palavras de ligação). */
export function palavras(texto: string): string[] {
  return semAcento(texto.toLowerCase()).split(/[^a-z0-9]+/).filter((p) => p.length >= 3 && p.length <= 30 && !PARADAS.has(p) && !/^\d+$/.test(p))
}

function tirarFrontmatter(texto: string): { meta: string; corpo: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(texto)
  return m ? { meta: m[1], corpo: texto.slice(m[0].length) } : { meta: '', corpo: texto }
}

export function indexarNota(n: NotaBruta): NotaIndexada {
  const id = normalizarCaminho(n.caminho)
  const partes = id.split('/')
  const arquivo = partes[partes.length - 1]
  const { meta, corpo } = tirarFrontmatter(n.texto)
  const h1 = /^#\s+(.+)$/m.exec(corpo)
  const tituloMeta = /^title:\s*["']?(.+?)["']?\s*$/mi.exec(meta)
  const titulo = (tituloMeta?.[1] ?? h1?.[1] ?? arquivo.replace(/\.[^.]+$/, '')).trim()
  const links = [...new Set([...corpo.matchAll(/\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g)].map((m) => m[1].trim().toLowerCase()))]
  const tagsCorpo = [...corpo.matchAll(/(?:^|\s)#([a-zA-ZÀ-ÿ][\w-]{1,30})/g)].map((m) => m[1].toLowerCase())
  const tagsMeta = /^tags:\s*\[?(.+?)\]?\s*$/mi.exec(meta)?.[1].split(/[,\s]+/).map((t) => t.replace(/["'#]/g, '').toLowerCase()).filter(Boolean) ?? []
  const tags = [...new Set([...tagsMeta, ...tagsCorpo])].slice(0, 20)
  const contagem = new Map<string, number>()
  for (const p of palavras(titulo + ' ' + titulo + ' ' + corpo)) contagem.set(p, (contagem.get(p) ?? 0) + 1)
  const top = [...contagem.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)
  const max = top[0]?.[1] ?? 1
  const termos: Record<string, number> = {}
  for (const [p, c] of top) termos[p] = c / max
  const resumo = corpo.replace(/^#.*$/gm, '').replace(/\[\[|\]\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200)
  return { id, titulo, pasta: partes.slice(0, -1).join('/'), links, tags, termos, resumo, tamanho: n.tamanho, alterado: n.alterado }
}

/** Arquivo que não é texto (ou é grande demais): entra só pelo nome e pela pasta. */
export function indexarSoNome(caminho: string, tamanho: number, alterado: number): NotaIndexada {
  return indexarNota({ caminho, texto: '', tamanho, alterado })
}

function cosseno(a: Record<string, number>, b: Record<string, number>): number {
  let dot = 0, na = 0, nb = 0
  for (const k in a) { na += a[k] * a[k]; if (k in b) dot += a[k] * b[k] }
  for (const k in b) nb += b[k] * b[k]
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

export interface OpcoesGrafo { vizinhosSimilares?: number; minSimilar?: number }

/** Monta o grafo: [[links]] entre notas, pasta em comum, tags em comum e similaridade de conteúdo (cosseno, ponderada pela raridade da palavra). */
export function construirGrafo(notas: NotaIndexada[], op: OpcoesGrafo = {}): GrafoSinapse {
  const k = op.vizinhosSimilares ?? 3
  const minimo = op.minSimilar ?? 0.18
  const lista = notas.slice(0, LIMITE_NOTAS)
  // Raridade: palavras que aparecem em quase todas as notas contam menos (idf).
  const df = new Map<string, number>()
  for (const n of lista) for (const t of Object.keys(n.termos)) df.set(t, (df.get(t) ?? 0) + 1)
  const pesados = lista.map((n) => {
    const t: Record<string, number> = {}
    for (const p in n.termos) t[p] = n.termos[p] * Math.log(1 + lista.length / (df.get(p) ?? 1))
    return t
  })
  const porNome = new Map<string, string>()
  for (const n of lista) {
    const nome = n.id.split('/').pop()!.replace(/\.[^.]+$/, '').toLowerCase()
    if (!porNome.has(nome)) porNome.set(nome, n.id)
    if (!porNome.has(n.titulo.toLowerCase())) porNome.set(n.titulo.toLowerCase(), n.id)
  }
  const ligacoes = new Map<string, LigacaoSinapse>()
  const ligar = (a: string, b: string, tipo: TipoLigacao, forca: number): void => {
    if (a === b) return
    const chave = a < b ? `${a}\0${b}` : `${b}\0${a}`
    const atual = ligacoes.get(chave)
    if (!atual || forca > atual.forca) ligacoes.set(chave, { origem: a, destino: b, tipo: atual && atual.tipo === 'link' ? 'link' : tipo, forca })
  }
  for (const n of lista) for (const l of n.links) { const d = porNome.get(l); if (d) ligar(n.id, d, 'link', 1) }
  // Mesma pasta: liga cada nota à vizinha seguinte (cadeia), sem criar um bloco completo.
  const porPasta = new Map<string, string[]>()
  for (const n of lista) porPasta.set(n.pasta, [...(porPasta.get(n.pasta) ?? []), n.id])
  for (const ids of porPasta.values()) for (let i = 1; i < ids.length; i++) ligar(ids[i - 1], ids[i], 'pasta', 0.3)
  const porTag = new Map<string, string[]>()
  for (const n of lista) for (const t of n.tags) porTag.set(t, [...(porTag.get(t) ?? []), n.id])
  for (const ids of porTag.values()) for (let i = 1; i < ids.length && i < 12; i++) ligar(ids[0], ids[i], 'tag', 0.5)
  if (k > 0 && lista.length <= 1500) {
    for (let i = 0; i < lista.length; i++) {
      const cand: [number, number][] = []
      for (let j = 0; j < lista.length; j++) if (j !== i) { const s = cosseno(pesados[i], pesados[j]); if (s >= minimo) cand.push([j, s]) }
      cand.sort((a, b) => b[1] - a[1])
      for (const [j, s] of cand.slice(0, k)) ligar(lista[i].id, lista[j].id, 'similar', s)
    }
  }
  const grau = new Map<string, number>()
  for (const l of ligacoes.values()) { grau.set(l.origem, (grau.get(l.origem) ?? 0) + 1); grau.set(l.destino, (grau.get(l.destino) ?? 0) + 1) }
  const nos: NoSinapse[] = lista.map((n) => ({ id: n.id, titulo: n.titulo, pasta: n.pasta, peso: 1 + (grau.get(n.id) ?? 0), tags: n.tags, resumo: n.resumo }))
  return { nos, ligacoes: [...ligacoes.values()] }
}

/** Busca simples pelo que a Sinapse aprendeu (título, tags e termos). */
export function buscar(notas: NotaIndexada[], consulta: string, max = 20): NotaIndexada[] {
  const q = palavras(consulta)
  if (!q.length) return []
  return notas
    .map((n) => {
      const alvo = semAcento(n.titulo.toLowerCase())
      let s = 0
      for (const p of q) s += (n.termos[p] ?? 0) + (alvo.includes(p) ? 2 : 0) + (n.tags.includes(p) ? 1 : 0)
      return [n, s] as const
    })
    .filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, max).map(([n]) => n)
}
