import { buscar, construirGrafo, type NotaIndexada } from './indexador'

// Servidor MCP da Sinapse (somente leitura): outras IAs (Claude Code, Codex, Gemini CLI...) consultam a mesma memória.
// Lógica pura do protocolo (JSON-RPC 2.0 sobre linhas), sem Electron e sem disco, para ser testável; o programa fica em mcp-sinapse.ts.
// Segurança: só serve o que está no índice da Sinapse (nunca um caminho qualquer), só com a chave ligada na dock, e nunca escreve.

export interface DepsMcp {
  ligado(): boolean
  notas(): NotaIndexada[]
  trecho(n: NotaIndexada, max: number): string
}
interface Requisicao { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> }
interface Resposta { jsonrpc: '2.0'; id: string | number | null; result?: unknown; error?: { code: number; message: string } }

export const VERSAO_MCP = '0.1.0'
const DESLIGADO = 'A Sinapse não está liberada para outras IAs. No Memoritrix Dock, abra a Sinapse > Pastas e arquivos > "Outras IAs (MCP)" e ligue a chave.'

const FERRAMENTAS = [
  { name: 'sinapse_buscar', description: 'Procura nas notas e arquivos que a Sinapse aprendeu (título, tags e assuntos). Devolve id, título, resumo e tags.', inputSchema: { type: 'object', properties: { consulta: { type: 'string', description: 'palavras ou assunto' }, limite: { type: 'number', description: 'máximo de resultados (1 a 10, padrão 5)' } }, required: ['consulta'] } },
  { name: 'sinapse_ler', description: 'Lê o começo do texto de uma nota da Sinapse pelo id devolvido na busca.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, max: { type: 'number', description: 'caracteres (padrão 4000, máximo 8000)' } }, required: ['id'] } },
  { name: 'sinapse_relacionadas', description: 'Lista as notas ligadas a uma nota (por [[link]], pasta, tag ou assunto parecido).', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'sinapse_listar', description: 'Lista títulos e ids das notas, opcionalmente só de uma pasta (até 200).', inputSchema: { type: 'object', properties: { pasta: { type: 'string', description: 'trecho do caminho da pasta' } } } }
]

const texto = (t: string, erro = false): { content: { type: 'text'; text: string }[]; isError?: boolean } => ({ content: [{ type: 'text', text: t }], ...(erro ? { isError: true } : {}) })
const num = (v: unknown, padrao: number, min: number, max: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.round(v))) : padrao)
const str = (v: unknown, max = 500): string => (typeof v === 'string' ? v.slice(0, max) : '')

function chamar(nome: string, a: Record<string, unknown>, d: DepsMcp): ReturnType<typeof texto> {
  if (!d.ligado()) return texto(DESLIGADO, true)
  const notas = d.notas()
  const achar = (id: string): NotaIndexada | undefined => notas.find((n) => n.id === id)
  if (nome === 'sinapse_buscar') {
    const r = buscar(notas, str(a.consulta, 200), num(a.limite, 5, 1, 10))
    return texto(r.length ? JSON.stringify(r.map((n) => ({ id: n.id, titulo: n.titulo, resumo: n.resumo, tags: n.tags })), null, 1) : 'Nada encontrado.')
  }
  if (nome === 'sinapse_ler') {
    const n = achar(str(a.id, 1000))
    return n ? texto(`# ${n.titulo}\n${d.trecho(n, num(a.max, 4000, 200, 8000))}`) : texto('Nota não encontrada no índice da Sinapse.', true)
  }
  if (nome === 'sinapse_relacionadas') {
    const n = achar(str(a.id, 1000))
    if (!n) return texto('Nota não encontrada no índice da Sinapse.', true)
    const g = construirGrafo(notas)
    const viz = g.ligacoes.filter((l) => l.origem === n.id || l.destino === n.id).map((l) => ({ id: l.origem === n.id ? l.destino : l.origem, tipo: l.tipo, forca: Math.round(l.forca * 100) / 100 }))
    const porId = new Map(notas.map((x) => [x.id, x.titulo]))
    return texto(viz.length ? JSON.stringify(viz.slice(0, 30).map((v) => ({ ...v, titulo: porId.get(v.id) })), null, 1) : 'Sem notas ligadas.')
  }
  if (nome === 'sinapse_listar') {
    const p = str(a.pasta, 300).toLowerCase().replace(/\\/g, '/')
    const r = notas.filter((n) => !p || n.pasta.toLowerCase().includes(p)).slice(0, 200)
    return texto(r.length ? r.map((n) => `${n.titulo} — ${n.id}`).join('\n') : 'Nenhuma nota.')
  }
  return texto(`Ferramenta desconhecida: ${nome}`, true)
}

/** Trata uma mensagem. Devolve a resposta, ou null para notificações (que não têm resposta). */
export function tratarMcp(req: Requisicao, d: DepsMcp): Resposta | null {
  const id = req.id
  if (id === undefined || id === null) return null // notificação (ex.: notifications/initialized)
  const ok = (result: unknown): Resposta => ({ jsonrpc: '2.0', id, result })
  const erro = (code: number, message: string): Resposta => ({ jsonrpc: '2.0', id, error: { code, message } })
  switch (req.method) {
    case 'initialize': return ok({ protocolVersion: typeof req.params?.protocolVersion === 'string' ? req.params.protocolVersion : '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'sinapse', version: VERSAO_MCP } })
    case 'ping': return ok({})
    case 'tools/list': return ok({ tools: FERRAMENTAS })
    case 'tools/call': {
      const nome = str(req.params?.name, 80)
      if (!FERRAMENTAS.some((f) => f.name === nome)) return erro(-32602, `Ferramenta desconhecida: ${nome}`)
      const args = req.params?.arguments && typeof req.params.arguments === 'object' ? (req.params.arguments as Record<string, unknown>) : {}
      try { return ok(chamar(nome, args, d)) } catch (e) { return ok(texto(`Erro: ${e instanceof Error ? e.message : String(e)}`, true)) }
    }
    default: return erro(-32601, `Método não suportado: ${String(req.method)}`)
  }
}
