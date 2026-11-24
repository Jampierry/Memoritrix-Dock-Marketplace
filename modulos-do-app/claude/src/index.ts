import { dialog } from 'electron'
import type { ModuloCodigo, ModuloContexto } from '@memoritrix/nucleo-modulos'
import type { DestinoClaude, ItemClaude, ItemClaudeVista, RespostaCatalogoClaude } from '../../compartilhado/src/claude'
import { baixar, destinoPermitido, MAX_PACOTE } from '../../marketplace/src/rede'
import manifesto from '../module.json'
import { URL_CATALOGO_CLAUDE, urlDoArquivoDaSkill, validarCatalogoClaude } from './catalogo'
import { estadoDoGraphify, instalarGraphify } from './graphify'
import { chaveDoPlugin, instalarPlugin, instalarSkill, pastaClaude, pluginInstalado, removerPlugin, removerSkill, skillInstalada } from './instalar'

export { manifesto }

// Módulo "Skills e plugins do Claude": lê o catálogo curado (assinado) do marketplace e instala no Claude Code. A interface só chega aqui
// por `modulos:invocar` (canais claude:*). Toda instalação ou remoção passa pela janela de confirmação do app, que só o usuário responde.

type Confirmar = (p: { titulo: string; detalhe: string; aviso?: string }) => Promise<boolean>
let confirmar: Confirmar = () => Promise.resolve(false) // sem a janela do app, nada é instalado
export const definirConfirmacaoClaude = (f: Confirmar): void => { confirmar = f }

const ARQ_PROJETO = 'claude-projeto.json'
const VALIDADE_MS = 10 * 60 * 1000
let cache: { em: number; itens: ItemClaude[]; ignoradas: string[] } | null = null

async function catalogo(forcar: boolean): Promise<{ itens: ItemClaude[]; ignoradas: string[] }> {
  if (!forcar && cache && Date.now() - cache.em < VALIDADE_MS) return cache
  const bruto = JSON.parse((await baixar(URL_CATALOGO_CLAUDE, 512 * 1024, destinoPermitido)).toString('utf-8')) as unknown
  cache = { em: Date.now(), ...validarCatalogoClaude(bruto) }
  return cache
}

const projetoSalvo = (ctx: ModuloContexto): string | null => ctx.dados.lerJson<{ pasta?: string }>(ARQ_PROJETO, {}).pasta ?? null

function estadoDe(item: ItemClaude, projeto: string | null): ItemClaudeVista['estado'] {
  const em = (d: DestinoClaude): boolean => {
    try {
      const base = pastaClaude(d, projeto)
      return item.tipo === 'skill' ? skillInstalada(base, item.id) : pluginInstalado(base, item)
    } catch { return false }
  }
  return { usuario: em('usuario'), projeto: projeto ? em('projeto') : false }
}

const rotuloDestino = (d: DestinoClaude, base: string): string => (d === 'usuario' ? `Claude Code do seu usuário (${base})` : `projeto do VS Code (${base})`)

export const codigo: ModuloCodigo = {
  ativar(ctx) {
    ctx.ipc.tratar('claude:catalogo', async (forcar): Promise<RespostaCatalogoClaude> => {
      try {
        const c = await catalogo(forcar === true)
        const projeto = projetoSalvo(ctx)
        return { ok: true, itens: c.itens.map((i) => ({ ...i, estado: estadoDe(i, projeto) })), ignoradas: c.ignoradas, projeto }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { ok: false, erro: /fetch failed|ENOTFOUND|timeout|abort/i.test(msg) ? 'Sem conexão com o GitHub.' : msg.startsWith('O GitHub respondeu 404') ? 'O catálogo ainda não foi publicado no repositório do marketplace.' : msg }
      }
    })

    // A pasta do projeto aberto no VS Code (onde fica a .claude do projeto). Escolhida uma vez e lembrada.
    ctx.ipc.tratar('claude:escolherProjeto', async (): Promise<{ ok: boolean; pasta?: string }> => {
      const r = await dialog.showOpenDialog({ title: 'Escolha a pasta do projeto aberto no VS Code', properties: ['openDirectory'], defaultPath: projetoSalvo(ctx) ?? undefined })
      if (r.canceled || !r.filePaths[0]) return { ok: false }
      ctx.dados.gravarJson(ARQ_PROJETO, { pasta: r.filePaths[0] })
      return { ok: true, pasta: r.filePaths[0] }
    })

    ctx.ipc.tratar('claude:instalar', async (id, destino): Promise<{ ok: boolean; erro?: string; texto?: string }> => {
      try {
        const item = (await catalogo(false)).itens.find((i) => i.id === id)
        if (!item) return { ok: false, erro: 'Item não encontrado no catálogo.' }
        if (destino !== 'usuario' && destino !== 'projeto') return { ok: false, erro: 'Destino inválido.' }
        const base = pastaClaude(destino, projetoSalvo(ctx))
        const origem = item.tipo === 'skill' ? `${item.repo}, commit ${item.ref?.slice(0, 10)}, pasta ${item.caminho}` : `plugin ${item.plugin} do marketplace ${item.marketplace?.nome} (${item.marketplace?.repo}), que acompanha a versão mais nova deles`
        const ok = await confirmar({
          titulo: `Instalar ${item.tipo === 'skill' ? 'a skill' : 'o plugin'} "${item.nome}" no Claude`,
          detalhe: [item.descricao, '', `Onde: ${rotuloDestino(destino, base)}`, `Origem: ${origem}`, item.licenca ? `Licença: ${item.licenca}` : '',
            item.tipo === 'skill' ? '' : 'O app só liga o plugin no settings.json (guardando uma cópia do arquivo). O próprio Claude Code baixa o plugin na próxima vez que abrir.'].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n'),
          aviso: 'Skills e plugins são instruções (e às vezes scripts) que o Claude segue com as suas permissões. Instale só de fontes em que você confia. Item aprovado no catálogo do marketplace.'
        })
        if (!ok) return { ok: false, erro: 'Cancelado.' }
        if (item.tipo === 'skill') {
          const zip = await baixar(urlDoArquivoDaSkill(item), MAX_PACOTE, destinoPermitido)
          const r = instalarSkill(item, zip, base)
          return { ok: true, texto: `"${item.nome}" instalada (${r.arquivos} arquivos). Abra uma conversa nova no Claude para ela valer.` }
        }
        instalarPlugin(item, base)
        return { ok: true, texto: `"${item.nome}" ligado. Reinicie o Claude Code para ele baixar o plugin.` }
      } catch (e) { return { ok: false, erro: e instanceof Error ? e.message : String(e) } }
    })

    // Graphify: o mapa do projeto que o Claude consulta (e que os assistentes do app também usam, pelas ferramentas mapa_*).
    ctx.ipc.tratar('claude:graphify-estado', () => estadoDoGraphify())
    ctx.ipc.tratar('claude:graphify-instalar', async (): Promise<{ ok: boolean; erro?: string; texto?: string }> => {
      try {
        const ok = await confirmar({
          titulo: 'Instalar o Graphify',
          detalhe: ['O Graphify transforma um projeto num mapa que o Claude consulta em vez de reler os arquivos (gasta menos tokens).', '',
            'O app vai rodar, nesta ordem:', '  1. uv tool install --force "graphifyy[mcp]"   (baixa o programa do PyPI)', '  2. graphify install --platform claude   (coloca a skill /graphify em ~/.claude/skills e cria ou acrescenta uma nota curta em ~/.claude/CLAUDE.md)', '',
            'Origem: github.com/Graphify-Labs/graphify (Apache-2.0), um projeto independente, que não é da Anthropic.'].join('\n'),
          aviso: 'Isto baixa e instala um programa da internet no seu computador. Instale só se você confia na origem.'
        })
        if (!ok) return { ok: false, erro: 'Cancelado.' }
        return { ok: true, texto: await instalarGraphify() }
      } catch (e) { return { ok: false, erro: e instanceof Error ? e.message : String(e) } }
    })

    ctx.ipc.tratar('claude:remover', async (id, destino): Promise<{ ok: boolean; erro?: string; texto?: string }> => {
      try {
        const item = (await catalogo(false)).itens.find((i) => i.id === id)
        if (!item) return { ok: false, erro: 'Item não encontrado no catálogo.' }
        if (destino !== 'usuario' && destino !== 'projeto') return { ok: false, erro: 'Destino inválido.' }
        const base = pastaClaude(destino, projetoSalvo(ctx))
        const ok = await confirmar({
          titulo: `Remover "${item.nome}" do Claude`,
          detalhe: `Onde: ${rotuloDestino(destino, base)}\n${item.tipo === 'skill' ? 'A pasta da skill que o app instalou será apagada. Skills suas, de outra origem, nunca são tocadas.' : `A linha ${chaveDoPlugin(item)} sai do settings.json (o marketplace cadastrado fica).`}`
        })
        if (!ok) return { ok: false, erro: 'Cancelado.' }
        const feito = item.tipo === 'skill' ? removerSkill(base, item.id) : removerPlugin(item, base)
        return feito ? { ok: true, texto: `"${item.nome}" removido.` } : { ok: false, erro: 'Não estava instalado por este app.' }
      } catch (e) { return { ok: false, erro: e instanceof Error ? e.message : String(e) } }
    })
  },
  desativar() {
    cache = null
  }
}
