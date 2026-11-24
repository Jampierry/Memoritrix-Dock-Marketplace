import { app } from 'electron'
import { existsSync, mkdirSync, statSync, watch, writeFileSync, type FSWatcher } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { ModuloContexto } from '@memoritrix/nucleo-modulos'
import { registrarResumos } from './resumos'
import { buscar, construirGrafo, deveIgnorarEvento, EXT_TEXTO, indexarNota, indexarSoNome, LIMITE_BYTES, LIMITE_NOTAS, normalizarCaminho, PASTAS_IGNORADAS, type GrafoSinapse, type NotaIndexada } from './indexador'

// Fontes da Sinapse: pastas e arquivos que o usuário escolhe. Só leitura; o índice fica em JSON na pasta de dados do app.

export interface Fonte { id: string; caminho: string; tipo: 'pasta' | 'arquivo'; ativa: boolean }
interface Indice { notas: NotaIndexada[]; atualizadoEm: number }
type Res<T> = { ok: true; dados: T } | { ok: false; erro: string }

const ARQ_FONTES = 'painel-fontes.json'
const ARQ_INDICE = 'painel-indice.json'
const PROFUNDIDADE_MAX = 8

/** Devolve o controle ao processo principal por um instante, para as janelas continuarem respondendo durante uma leitura longa. */
const ceder = (): Promise<void> => new Promise((ok) => setImmediate(ok))

/**
 * Percorre uma fonte e devolve as notas indexadas. Reaproveita do cache quem não mudou (mesmo tamanho e data).
 * Lê o disco de forma assíncrona e cede a vez a cada ~12 ms de trabalho: pastas grandes não travam o app.
 */
export async function varrer(fonte: Fonte, cache: Map<string, NotaIndexada>, restante: { n: number }): Promise<NotaIndexada[]> {
  const saida: NotaIndexada[] = []
  let inicio = Date.now()
  const respirar = async (): Promise<void> => { if (Date.now() - inicio > 12) { await ceder(); inicio = Date.now() } }
  const arquivo = async (caminho: string, tamanho: number, alterado: number): Promise<void> => {
    if (restante.n <= 0) return
    const id = normalizarCaminho(caminho)
    const antigo = cache.get(id)
    if (antigo && antigo.tamanho === tamanho && antigo.alterado === alterado) { saida.push(antigo); restante.n--; return }
    const texto = (EXT_TEXTO as readonly string[]).includes(extname(caminho).toLowerCase()) && tamanho <= LIMITE_BYTES
    try { saida.push(texto ? indexarNota({ caminho, texto: await readFile(caminho, 'utf-8'), tamanho, alterado }) : indexarSoNome(caminho, tamanho, alterado)) } catch { return }
    restante.n--
  }
  const andar = async (pasta: string, nivel: number): Promise<void> => {
    if (nivel > PROFUNDIDADE_MAX || restante.n <= 0) return
    let itens
    try { itens = await readdir(pasta, { withFileTypes: true }) } catch { return }
    for (const d of itens) {
      if (restante.n <= 0) return
      await respirar()
      if (d.name.startsWith('.') && d.isDirectory()) continue
      const cam = join(pasta, d.name)
      if (d.isSymbolicLink()) continue // não segue atalhos: evita laços e sair da pasta escolhida
      if (d.isDirectory()) { if (!PASTAS_IGNORADAS.has(d.name.toLowerCase())) await andar(cam, nivel + 1) }
      else if (d.isFile()) { try { const s = await stat(cam); await arquivo(cam, s.size, Math.floor(s.mtimeMs)) } catch { /* sem acesso */ } }
    }
  }
  try {
    const s = await stat(fonte.caminho)
    if (fonte.tipo === 'arquivo' && s.isFile()) await arquivo(fonte.caminho, s.size, Math.floor(s.mtimeMs))
    else if (fonte.tipo === 'pasta' && s.isDirectory()) await andar(fonte.caminho, 0)
  } catch { /* fonte sumiu: ignora */ }
  return saida
}

/** Nome de arquivo seguro a partir do título: sem caminho, sem caracteres proibidos no Windows, sem nome reservado. */
export function nomeDeNota(titulo: string): string {
  const base = titulo.normalize('NFC').replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 80)
  const limpo = base || 'Nota'
  return (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(limpo) ? `${limpo}_` : limpo) + '.md'
}

/** Registra os canais da Sinapse e devolve a função que desfaz o vigia (chamada ao desativar o módulo). */
export function registrarSinapse(ctx: ModuloContexto): () => void {
  const fontes = (): Fonte[] => ctx.dados.lerJson<Fonte[]>(ARQ_FONTES, []).filter((f) => f && typeof f.caminho === 'string')
  const indice = (): Indice => ctx.dados.lerJson<Indice>(ARQ_INDICE, { notas: [], atualizadoEm: 0 })
  let ocupado = false
  registrarResumos(ctx, () => indice().notas)

  ctx.ipc.tratar('painel:fontes', (): Res<Fonte[]> => ({ ok: true, dados: fontes() }))
  ctx.ipc.tratar('painel:fonte-adicionar', (caminho, tipo): Res<Fonte[]> => {
    const c = typeof caminho === 'string' ? caminho.trim() : ''
    if (!c) return { ok: false, erro: 'Escolha uma pasta ou arquivo.' }
    let existe: 'pasta' | 'arquivo'
    try { existe = statSync(c).isDirectory() ? 'pasta' : 'arquivo' } catch { return { ok: false, erro: 'Não achei esse caminho.' } }
    if (tipo && tipo !== existe) return { ok: false, erro: `Isso é ${existe === 'pasta' ? 'uma pasta' : 'um arquivo'}.` }
    const lista = fontes()
    const id = normalizarCaminho(c).toLowerCase()
    if (lista.some((f) => normalizarCaminho(f.caminho).toLowerCase() === id)) return { ok: false, erro: 'Essa fonte já está na Sinapse.' }
    const nova = [...lista, { id: `${Date.now().toString(36)}-${basename(c)}`, caminho: c, tipo: existe, ativa: true }]
    ctx.dados.gravarJson(ARQ_FONTES, nova)
    return { ok: true, dados: nova }
  })
  ctx.ipc.tratar('painel:fonte-remover', (id): Res<Fonte[]> => {
    const nova = fontes().filter((f) => f.id !== id)
    ctx.dados.gravarJson(ARQ_FONTES, nova)
    // O índice some junto com a fonte: a Sinapse esquece o que aprendeu dela.
    const idx = indice()
    const ativas = nova.map((f) => normalizarCaminho(f.caminho).toLowerCase())
    ctx.dados.gravarJson(ARQ_INDICE, { ...idx, notas: idx.notas.filter((n) => ativas.some((a) => n.id.toLowerCase().startsWith(a))) })
    return { ok: true, dados: nova }
  })
  ctx.ipc.tratar('painel:fonte-ativar', (id, ativa): Res<Fonte[]> => {
    const nova = fontes().map((f) => (f.id === id ? { ...f, ativa: ativa === true } : f))
    ctx.dados.gravarJson(ARQ_FONTES, nova)
    return { ok: true, dados: nova }
  })
  // Lê as fontes ativas e atualiza o que a Sinapse sabe. Só o que mudou é relido.
  const aprenderAgora = async (): Promise<Res<{ notas: number; atualizadoEm: number }>> => {
    if (ocupado) return { ok: false, erro: 'A Sinapse já está aprendendo.' }
    ocupado = true
    try {
      const cache = new Map(indice().notas.map((n) => [n.id, n]))
      const restante = { n: LIMITE_NOTAS }
      const notas = new Map<string, NotaIndexada>()
      for (const f of fontes().filter((x) => x.ativa)) for (const n of await varrer(f, cache, restante)) notas.set(n.id, n)
      const novo: Indice = { notas: [...notas.values()], atualizadoEm: Date.now() }
      ctx.dados.gravarJson(ARQ_INDICE, novo)
      return { ok: true, dados: { notas: novo.notas.length, atualizadoEm: novo.atualizadoEm } }
    } finally { ocupado = false }
  }
  ctx.ipc.tratar('painel:aprender', aprenderAgora)
  ctx.ipc.tratar('painel:atualizado', (): Res<{ atualizadoEm: number; notas: number }> => { const i = indice(); return { ok: true, dados: { atualizadoEm: i.atualizadoEm, notas: i.notas.length } } })

  // Vigia: observa as fontes ativas e, quando algo muda, a Sinapse reaprende sozinha (espera 5 s de calma e no mínimo 15 s entre rodadas).
  const vigiaLigado = (): boolean => ctx.dados.lerJson<{ ligado?: boolean }>('painel-vigia.json', {}).ligado !== false
  ctx.ipc.tratar('painel:vigia', (): Res<{ ligado: boolean }> => ({ ok: true, dados: { ligado: vigiaLigado() } }))
  ctx.ipc.tratar('painel:vigia-definir', (v): Res<{ ligado: boolean }> => { ctx.dados.gravarJson('painel-vigia.json', { ligado: v === true }); sincronizarVigia(); return { ok: true, dados: { ligado: vigiaLigado() } } })
  const vigias = new Map<string, FSWatcher>()
  let assinatura = ''
  let temporizador: ReturnType<typeof setTimeout> | null = null
  let ultimaRodada = 0
  const agendar = (ms = 5000): void => { if (temporizador) clearTimeout(temporizador); temporizador = setTimeout(rodar, ms) }
  function rodar(): void {
    temporizador = null
    if (ocupado) return agendar()
    const espera = ultimaRodada + 15000 - Date.now()
    if (espera > 0) return agendar(espera)
    ultimaRodada = Date.now()
    void aprenderAgora().catch(() => { /* a próxima rodada tenta de novo */ })
  }
  const fecharVigias = (): void => { for (const w of vigias.values()) { try { w.close() } catch { /* já fechado */ } } vigias.clear() }
  function sincronizarVigia(): void {
    const alvo = vigiaLigado() ? fontes().filter((f) => f.ativa) : []
    const nova = alvo.map((f) => f.caminho).sort().join('|')
    if (nova === assinatura) return
    assinatura = nova
    fecharVigias()
    for (const f of alvo) {
      try {
        const w = watch(f.caminho, { recursive: f.tipo === 'pasta' }, (_ev, nome) => {
          if (f.tipo === 'pasta' && nome && deveIgnorarEvento(String(nome))) return
          agendar()
        })
        w.on('error', () => { try { w.close() } catch { /* ok */ } vigias.delete(f.caminho); assinatura = '' }) // pasta sumiu: tenta de novo na próxima checagem
        vigias.set(f.caminho, w)
      } catch { /* sem permissão ou caminho inexistente: segue sem vigiar essa fonte */ }
    }
  }
  sincronizarVigia()
  const verificador = setInterval(sincronizarVigia, 10000) // pega fontes novas, removidas ou pausadas
  // Notas escritas na própria dock: ficam em arquivos .md numa pasta do app, que vira uma fonte da Sinapse.
  const pastaNotas = (): string => { const d = join(app.getPath('userData'), 'notas'); if (!existsSync(d)) mkdirSync(d, { recursive: true }); return d }
  const salvarNota = (titulo: unknown, texto: unknown): Res<{ caminho: string }> => {
    const t = typeof titulo === 'string' ? titulo.trim().slice(0, 120) : ''
    const corpo = typeof texto === 'string' ? texto.slice(0, 200_000) : ''
    if (!t && !corpo.trim()) return { ok: false, erro: 'Escreva um título ou um texto.' }
    const dir = pastaNotas()
    let caminho = join(dir, nomeDeNota(t || corpo.split('\n')[0]))
    for (let n = 2; existsSync(caminho) && n < 99; n++) caminho = join(dir, nomeDeNota(`${t || 'Nota'} ${n}`))
    writeFileSync(caminho, (t && !/^#\s/m.test(corpo) ? `# ${t}\n\n` : '') + corpo, 'utf-8')
    const lista = fontes()
    if (!lista.some((f) => normalizarCaminho(f.caminho).toLowerCase() === normalizarCaminho(dir).toLowerCase())) {
      ctx.dados.gravarJson(ARQ_FONTES, [...lista, { id: 'notas-da-dock', caminho: dir, tipo: 'pasta', ativa: true }])
    }
    return { ok: true, dados: { caminho } }
  }
  // Arquivo de nome fixo na pasta de notas (reescrito a cada vez, sem cópias numeradas): usado pelo mapa de habilidades dos agentes.
  const escreverArquivo = (nome: string, texto: string): { ok: boolean; erro?: string } => {
    const arq = typeof nome === 'string' ? nome.replace(/[^\w.-]/g, '') : ''
    if (!/\.md$/i.test(arq) || arq.length < 4) return { ok: false, erro: 'Nome inválido.' }
    const dir = pastaNotas()
    writeFileSync(join(dir, arq), String(texto).slice(0, 400_000), 'utf-8')
    const lista = fontes()
    if (!lista.some((f) => normalizarCaminho(f.caminho).toLowerCase() === normalizarCaminho(dir).toLowerCase())) {
      ctx.dados.gravarJson(ARQ_FONTES, [...lista, { id: 'notas-da-dock', caminho: dir, tipo: 'pasta', ativa: true }])
    }
    return { ok: true }
  }
  ctx.servicos.registrar('painel.escreverArquivo', escreverArquivo)
  ctx.ipc.tratar('painel:nota-salvar', salvarNota)
  // Serviços para a IA do Memorix (só buscar resumos e criar notas; nunca ler arquivos inteiros nem apagar).
  ctx.servicos.registrar('painel.buscar', (q: string) => buscar(indice().notas, q, 5).map((n) => ({ titulo: n.titulo, resumo: n.resumo })))
  ctx.servicos.registrar('painel.criarNota', (t: string, x: string) => { const r = salvarNota(t, x); return r.ok ? { ok: true } : { ok: false, erro: r.erro } })
  // MCP (somente leitura): outras IAs consultam a Sinapse. Desligado por padrão; a chave é conferida pelo servidor a cada chamada.
  const mcpLigado = (): boolean => ctx.dados.lerJson<{ ligado?: boolean }>('painel-mcp.json', {}).ligado === true
  const mcpInfo = (): { ligado: boolean; comando: string; args: string[]; env: Record<string, string> } => ({
    ligado: mcpLigado(), comando: process.execPath, args: [join(app.getAppPath(), 'out', 'main', 'mcp-sinapse.js')],
    env: { ELECTRON_RUN_AS_NODE: '1', SINAPSE_DADOS: app.getPath('userData') }
  })
  ctx.ipc.tratar('painel:mcp-config', (): Res<ReturnType<typeof mcpInfo>> => ({ ok: true, dados: mcpInfo() }))
  ctx.ipc.tratar('painel:mcp-ligar', (v): Res<ReturnType<typeof mcpInfo>> => { ctx.dados.gravarJson('painel-mcp.json', { ligado: v === true }); return { ok: true, dados: mcpInfo() } })
  ctx.ipc.tratar('painel:grafo', (): Res<GrafoSinapse> => ({ ok: true, dados: construirGrafo(indice().notas) }))
  ctx.ipc.tratar('painel:buscar', (q): Res<{ id: string; titulo: string; resumo: string }[]> => ({
    ok: true, dados: buscar(indice().notas, typeof q === 'string' ? q : '').map((n) => ({ id: n.id, titulo: n.titulo, resumo: n.resumo }))
  }))
  return () => { clearInterval(verificador); if (temporizador) clearTimeout(temporizador); fecharVigias() }
}
