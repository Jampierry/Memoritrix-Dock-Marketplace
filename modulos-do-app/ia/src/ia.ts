import { app, clipboard, safeStorage, shell } from 'electron'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DadosDoNucleo, ModuloContexto } from '@memoritrix/nucleo-modulos'
import type { EstadoIA, PeriodoUso, ProvedorIA, Resultado, UsoIA } from '@shared/tipos'
import { BASE, cli, COMBO, definirMarcaServidorOculto, encerrarServidor, gatewayNoAr, permitirServidor, garantirGateway, garantirServidorOculto, RAIZ } from './omniroute'

// IA do dock: fila de provedores com fallback, feita sobre o OmniRoute que o IAConfig já instala.
// O dock só configura: guarda a fila e as chaves (criptografadas pelo Windows, só neste processo) e aplica no OmniRoute
// com os mesmos comandos do IAConfig. As chaves nunca vão para a interface nem para log.

// Os dados (ia.json) vêm do armazenamento emprestado pelo núcleo; as chaves continuam no cofre do sistema (ia-chaves.bin).
let dados: DadosDoNucleo
const lerJson = <T,>(nome: string, padrao: T): T => dados.lerJson(nome, padrao)
const gravarJson = (nome: string, valor: unknown): void => dados.gravarJson(nome, valor)

interface Cat { id: string; nome: string; gratis: boolean; conn: string; link: string; prefixo?: string; modelo?: string }
const CATALOGO: Cat[] = [
  // Conta do Claude (login pelo navegador no OmniRoute, sem chave de API): no OmniRoute o provedor se chama "claude" e os modelos começam com "cc/".
  { id: 'claude', nome: 'Claude (sua conta)', gratis: false, conn: 'claude-conta', link: '', prefixo: 'cc', modelo: 'cc/claude-sonnet-5-5' },
  { id: 'groq', nome: 'Groq', gratis: true, conn: 'groq-free', link: 'https://console.groq.com/keys' },
  { id: 'gemini', nome: 'Google Gemini', gratis: true, conn: 'gemini-free', link: 'https://aistudio.google.com/apikey' },
  { id: 'openrouter', nome: 'OpenRouter', gratis: true, conn: 'openrouter-free', link: 'https://openrouter.ai/keys' },
  { id: 'cerebras', nome: 'Cerebras', gratis: true, conn: 'cerebras-free', link: 'https://cloud.cerebras.ai' },
  { id: 'nvidia', nome: 'NVIDIA NIM', gratis: true, conn: 'nvidia-free', link: 'https://build.nvidia.com' },
  { id: 'sambanova', nome: 'SambaNova', gratis: true, conn: 'sambanova-free', link: 'https://cloud.sambanova.ai' },
  { id: 'anthropic', nome: 'Anthropic (Claude)', gratis: false, conn: 'anthropic-pago', link: 'https://console.anthropic.com/settings/keys' },
  { id: 'openai', nome: 'OpenAI (GPT)', gratis: false, conn: 'openai-pago', link: 'https://platform.openai.com/api-keys' },
  { id: 'deepseek', nome: 'DeepSeek', gratis: false, conn: 'deepseek-pago', link: 'https://platform.deepseek.com/api_keys' },
  { id: 'mistral', nome: 'Mistral', gratis: false, conn: 'mistral-pago', link: 'https://console.mistral.ai/api-keys' },
  { id: 'xai', nome: 'xAI (Grok)', gratis: false, conn: 'xai-pago', link: 'https://console.x.ai' }
]
const porId = new Map(CATALOGO.map((c) => [c.id, c]))
/** Provedores que um assistente pode usar (os mesmos da fila). */
export const provedorValido = (id: unknown): id is string => typeof id === 'string' && porId.has(id)
/** Acha o modelo de um provedor na lista do OmniRoute; se a lista não veio (a API local pode exigir chave), usa o modelo fixo do catálogo. */
export const modeloDoProvedor = (id: string, lista: string[]): string | undefined => {
  const c = porId.get(id)
  return lista.find((m) => m.startsWith(`${c?.prefixo ?? id}/`)) ?? c?.modelo
}
export const nomeDoProvedor = (id: string): string => porId.get(id)?.nome ?? id

interface Salvo { ordem: string[]; ligados: Record<string, boolean>; modo: 'auto' | 'fixo'; fixo: string }
const PADRAO: Salvo = { ordem: CATALOGO.map((c) => c.id), ligados: {}, modo: 'auto', fixo: 'groq' }

const lerSalvo = (): Salvo => {
  const s = { ...PADRAO, ...lerJson<Partial<Salvo>>('ia.json', {}) }
  // Mantém só ids conhecidos e acrescenta os que faltam no fim (catálogo novo).
  const ordem = s.ordem.filter((i) => porId.has(i))
  for (const c of CATALOGO) if (!ordem.includes(c.id)) ordem.push(c.id)
  return { ...s, ordem }
}

// ---- chaves (safeStorage) ----
const arquivoChaves = (): string => {
  const p = app.getPath('userData')
  if (!existsSync(p)) mkdirSync(p, { recursive: true })
  return join(p, 'ia-chaves.bin')
}
const memoria: Record<string, string> = {} // sem criptografia disponível: só enquanto o app roda
function lerChaves(): Record<string, string> {
  try {
    if (!safeStorage.isEncryptionAvailable()) return { ...memoria }
    return JSON.parse(safeStorage.decryptString(readFileSync(arquivoChaves()))) as Record<string, string>
  } catch {
    return { ...memoria }
  }
}
function gravarChaves(c: Record<string, string>): void {
  Object.keys(memoria).forEach((k) => delete memoria[k])
  Object.assign(memoria, c)
  if (!safeStorage.isEncryptionAvailable()) return
  if (Object.keys(c).length === 0) return rmSync(arquivoChaves(), { force: true })
  writeFileSync(arquivoChaves(), safeStorage.encryptString(JSON.stringify(c)))
}

/** Lê `omniroute --output json usage quota` de forma tolerante: aceita objeto ou lista com provedor e uso/limite/percentual. */
async function lerUso(): Promise<Record<string, { pct: number; texto: string }>> {
  const r = await cli(['--output', 'json', 'usage', 'quota'], undefined, 20000)
  const mapa: Record<string, { pct: number; texto: string }> = {}
  if (!r.ok) return mapa
  const m = /[[{][\s\S]*[\]}]/.exec(r.saida)
  if (!m) return mapa
  let json: unknown
  try { json = JSON.parse(m[0]) } catch { return mapa }
  const visitar = (v: unknown): void => {
    if (Array.isArray(v)) return v.forEach(visitar)
    if (!v || typeof v !== 'object') return
    const o = v as Record<string, unknown>
    const id = String(o.provider ?? o.providerId ?? o.id ?? '').toLowerCase()
    const num = (k: string[]): number | null => { for (const x of k) if (typeof o[x] === 'number') return o[x] as number; return null }
    const usado = num(['used', 'usage', 'consumed']), lim = num(['limit', 'quota', 'max', 'total'])
    const pct = num(['percent', 'percentage', 'usedPercent']) ?? (usado !== null && lim ? (usado / lim) * 100 : null)
    if (id && porId.has(id) && pct !== null) mapa[id] = { pct: Math.min(100, Math.max(0, Math.round(pct))), texto: usado !== null && lim ? `${usado} de ${lim}` : `${Math.round(pct)}% usado` }
    Object.values(o).forEach(visitar)
  }
  visitar(json)
  return mapa
}

// O CLI leva alguns segundos: a tela espera no máximo 4 s e o resultado fica em cache para a próxima leitura.
let cacheUso: Record<string, { pct: number; texto: string }> = {}
let atualizando: Promise<void> | null = null
async function usoRapido(): Promise<Record<string, { pct: number; texto: string }>> {
  atualizando ??= lerUso().then((u) => { cacheUso = u }).finally(() => { atualizando = null })
  await Promise.race([atualizando, new Promise((r) => setTimeout(r, 4000))])
  return cacheUso
}

// Provedores que já estão cadastrados (e ativos) no OmniRoute, mesmo sem chave guardada no dock.
let cacheReg = new Set<string>()
let atualizandoReg: Promise<void> | null = null
async function lerRegistrados(): Promise<Set<string>> {
  const r = await cli(['providers', 'list', '--json'], undefined, 20000)
  const m = /\{[\s\S]*\}/.exec(r.saida)
  const ids = new Set<string>()
  if (!r.ok || !m) return ids
  try {
    for (const p of (JSON.parse(m[0]) as { providers?: { provider?: string; isActive?: boolean }[] }).providers ?? [])
      if (p.provider && p.isActive !== false && porId.has(p.provider)) ids.add(p.provider)
  } catch { /* formato inesperado: ignora */ }
  return ids
}
async function registradosRapido(): Promise<Set<string>> {
  atualizandoReg ??= lerRegistrados().then((u) => { cacheReg = u }).finally(() => { atualizandoReg = null })
  await Promise.race([atualizandoReg, new Promise((r) => setTimeout(r, 4000))])
  return cacheReg
}

async function estado(): Promise<EstadoIA> {
  const s = lerSalvo()
  const chaves = lerChaves()
  let gateway = await gatewayNoAr()
  if (gateway) { await garantirServidorOculto(); gateway = await gatewayNoAr() } // troca o servidor antigo (que abre terminal) por um oculto
  let uso: Record<string, { pct: number; texto: string }> = {}
  let registrados = new Set<string>()
  if (gateway) [uso, registrados] = await Promise.all([usoRapido(), registradosRapido()]) // sem gateway não há o que ler
  const base: ProvedorIA[] = s.ordem.map((id) => {
    const c = porId.get(id) as Cat
    const u = uso[id]
    return { id, nome: c.nome, gratis: c.gratis, ligado: s.ligados[id] !== false, temChave: !!chaves[id] || registrados.has(id), usoPct: u?.pct ?? null, usoTexto: u?.texto ?? '', ativo: false }
  })
  const disponivel = (p: ProvedorIA): boolean => p.ligado && p.temChave && (p.usoPct ?? 0) < 100
  const escolhido = s.modo === 'fixo' ? base.find((p) => p.id === s.fixo && disponivel(p)) : base.find(disponivel)
  if (escolhido) escolhido.ativo = true
  return { gateway, modo: s.modo, fixo: s.fixo, provedores: base, ativo: escolhido?.id ?? null }
}

/** Aplica a fila no OmniRoute: cadastra as chaves (por stdin) e recria o combo na ordem escolhida. */
async function aplicar(): Promise<Resultado<string>> {
  const s = lerSalvo()
  const chaves = lerChaves()
  const noGateway = (await gatewayNoAr()) ? await lerRegistrados() : new Set<string>()
  const usar = s.ordem.filter((id) => s.ligados[id] !== false && (chaves[id] || noGateway.has(id)))
  if (usar.length === 0) return { ok: false, erro: 'Cadastre ao menos uma chave e deixe o provedor ligado.' }
  if (!(await garantirGateway())) return { ok: false, erro: 'O OmniRoute não abriu. Ligue-o em Ajustes > IA ou instale os componentes da IA.' }
  for (const id of usar.filter((i) => chaves[i])) {
    const c = porId.get(id) as Cat
    await cli(['providers', 'remove', c.conn, '--yes'])
    const r = await cli(['providers', 'add', id, '--name', c.conn, '--credential-stdin', '--yes'], chaves[id])
    if (!r.ok) return { ok: false, erro: `Falha ao cadastrar ${c.nome}.` }
  }
  // O combo usa ids de modelo reais: pega, em /v1/models, o primeiro de cada provedor (prefixo "<id>/").
  let ids: string[] = []
  try {
    const r = await fetch(`${BASE}/models`, { signal: AbortSignal.timeout(8000) })
    ids = ((await r.json()) as { data?: { id?: string }[] }).data?.map((m) => String(m.id ?? '')) ?? []
  } catch { /* segue sem modelos */ }
  const escolhidos = usar.map((id) => modeloDoProvedor(id, ids)).filter((m): m is string => !!m)
  if (escolhidos.length === 0) return { ok: false, erro: 'O OmniRoute não listou modelos para essas chaves. Confira as chaves no IAConfig.' }
  const modelos = escolhidos.join(',')
  await cli(['combo', 'delete', COMBO, '--yes'])
  const combo = await cli(['combo', 'create', COMBO, '--strategy', 'priority', '--models', modelos])
  if (!combo.ok) return { ok: false, erro: 'Falha ao criar o combo de fallback.' }
  await cli(['combo', 'switch', COMBO])
  return { ok: true, dados: `Fila aplicada: ${usar.map((i) => (porId.get(i) as Cat).nome).join(' > ')}` }
}

// Janela de contexto aproximada (tokens) por provedor: o OmniRoute não informa, então vale como referência.
const JANELA: Record<string, number> = { claude: 200000, anthropic: 200000, gemini: 1000000, groq: 131072, openrouter: 131072, cerebras: 131072, nvidia: 131072, sambanova: 131072, openai: 128000, deepseek: 65536, mistral: 128000, xai: 131072 }

const jsonDe = (saida: string): unknown => {
  const m = /[[{][\s\S]*[\]}]/.exec(saida)
  if (!m) return null
  try { return JSON.parse(m[0]) } catch { return null }
}

/** Uso da IA (tokens, pedidos, custo e série no tempo), lido do OmniRoute: `usage analytics` para os totais e `usage logs` para o gráfico. */
async function uso(periodo: unknown): Promise<Resultado<UsoIA>> {
  const per: PeriodoUso = periodo === '1d' || periodo === '30d' ? periodo : '7d'
  if (!(await gatewayNoAr())) return { ok: false, erro: 'O OmniRoute está desligado.' }
  const [an, lg, est] = await Promise.all([cli(['--output', 'json', 'usage', 'analytics', '--period', per], undefined, 25000), cli(['--output', 'json', 'usage', 'logs', '--limit', '500'], undefined, 25000), estado()])
  const linhas = (jsonDe(an.saida) as { provider?: string; requests?: number; tokensIn?: number; tokensOut?: number; costUsd?: number }[] | null) ?? []
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  const porProvedor = (Array.isArray(linhas) ? linhas : []).map((l) => ({ nome: String(l.provider ?? '?'), pedidos: num(l.requests), tokens: num(l.tokensIn) + num(l.tokensOut), custoUsd: num(l.costUsd) }))
    .filter((l) => l.pedidos > 0).sort((a, b) => b.tokens - a.tokens || b.pedidos - a.pedidos)
  const registros = (jsonDe(lg.saida) as { timestamp?: string; status?: number }[] | null) ?? []
  // Série: por hora nas últimas 24 h; por dia nos últimos 7 ou 30.
  const agora = new Date()
  const porHora = per === '1d'
  const n = porHora ? 24 : per === '7d' ? 7 : 30
  const chave = (d: Date): string => (porHora ? `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}` : `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`)
  const serie = Array.from({ length: n }, (_, i) => {
    const d = new Date(agora)
    if (porHora) d.setHours(agora.getHours() - (n - 1 - i), 0, 0, 0)
    else d.setDate(agora.getDate() - (n - 1 - i))
    return { d, k: chave(d), rotulo: porHora ? `${String(d.getHours()).padStart(2, '0')}h` : `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`, pedidos: 0, falhas: 0 }
  })
  const idx = new Map(serie.map((s, i) => [s.k, i]))
  for (const r of Array.isArray(registros) ? registros : []) {
    const t = r.timestamp ? new Date(r.timestamp) : null
    const i = t && !Number.isNaN(t.getTime()) ? idx.get(chave(t)) : undefined
    if (i === undefined) continue
    serie[i].pedidos++
    if ((r.status ?? 200) >= 400) serie[i].falhas++
  }
  const ativoId = est.ativo
  const ativo = ativoId ? { nome: nomeDoProvedor(ativoId), janela: JANELA[ativoId] ?? null } : null
  return {
    ok: true,
    dados: {
      periodo: per,
      pedidos: porProvedor.reduce((a, l) => a + l.pedidos, 0),
      falhas: serie.reduce((a, s) => a + s.falhas, 0),
      tokensEntrada: (Array.isArray(linhas) ? linhas : []).reduce((a, l) => a + num(l.tokensIn), 0),
      tokensSaida: (Array.isArray(linhas) ? linhas : []).reduce((a, l) => a + num(l.tokensOut), 0),
      custoUsd: porProvedor.reduce((a, l) => a + l.custoUsd, 0),
      porProvedor: porProvedor.slice(0, 6),
      serie: serie.map(({ rotulo, pedidos, falhas }) => ({ rotulo, pedidos, falhas })),
      ativo
    }
  }
}

export function registrarIA(ctx: ModuloContexto): void {
  dados = ctx.dados
  app.on('will-quit', () => encerrarServidor()) // ao fechar o app, o servidor do OmniRoute que ele criou fecha junto
  // O OmniRoute liga junto com o app (a menos que o usuário o tenha desligado em Ajustes > IA): a escolha fica guardada nos dados do módulo.
  const ligadoPref = (): boolean => lerJson<{ ligado?: boolean }>('omniroute.json', {}).ligado !== false
  permitirServidor(ligadoPref())
  if (ligadoPref() && !process.env['DOCK_DADOS'] && !process.env['VITEST']) setTimeout(() => { void garantirGateway() }, 2500)
  definirMarcaServidorOculto({ ler: () => lerJson<{ feito?: boolean }>('omniroute-oculto.json', {}).feito === true, gravar: () => gravarJson('omniroute-oculto.json', { feito: true }) })
  const t = ctx.ipc.tratar
  t('ia:estado', () => estado())
  t('ia:uso', (p) => uso(p))
  t('ia:omniroute-estado', async (): Promise<Resultado<{ ligado: boolean; noAr: boolean }>> => ({ ok: true, dados: { ligado: ligadoPref(), noAr: await gatewayNoAr() } }))
  t('ia:omniroute-definir', async (v): Promise<Resultado<{ ligado: boolean; noAr: boolean }>> => {
    const ligado = v === true
    gravarJson('omniroute.json', { ligado })
    permitirServidor(ligado)
    if (ligado) await garantirGateway(); else encerrarServidor(true)
    return { ok: true, dados: { ligado, noAr: await gatewayNoAr() } }
  })
  t('ia:salvar', (arg) => {
    const p = (arg ?? {}) as Partial<Salvo>
    const s = lerSalvo()
    if (Array.isArray(p.ordem) && p.ordem.every((i) => porId.has(i))) s.ordem = p.ordem
    if (p.ligados && typeof p.ligados === 'object') s.ligados = Object.fromEntries(Object.entries(p.ligados).filter(([k]) => porId.has(k)).map(([k, v]) => [k, !!v]))
    if (p.modo === 'auto' || p.modo === 'fixo') s.modo = p.modo
    if (typeof p.fixo === 'string' && porId.has(p.fixo)) s.fixo = p.fixo
    gravarJson('ia.json', s)
  })
  t('ia:chave', (id, chave) => {
    if (!porId.has(String(id))) return
    const c = lerChaves()
    const k = String(chave ?? '').trim()
    if (k) c[String(id)] = k.slice(0, 600)
    else delete c[String(id)]
    gravarChaves(c)
  })
  t('ia:aplicar', () => aplicar())
  // Só o endereço e o modelo vão para a área de transferência; a chave do OmniRoute o usuário copia à parte.
  t('ia:copiarOpenBot', () => { clipboard.writeText(`${BASE}\n${COMBO}`) })
  t('ia:abrirGuia', (id) => { const c = porId.get(String(id)); if (c) void shell.openExternal(c.link) })
  t('ia:abrirPainel', () => void shell.openExternal(RAIZ))
}
