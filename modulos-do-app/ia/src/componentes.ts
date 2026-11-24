import { app } from 'electron'
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ModuloContexto } from '@memoritrix/nucleo-modulos'
import type { Resultado } from '@shared/tipos'
import { pedirConfirmacao } from './ferramentas'

// Componentes da IA (Node.js e OmniRoute): verifica o que há no computador e instala ou atualiza com o script que acompanha o app
// (o mesmo que o instalador roda). Nunca instala sem a confirmação do usuário na janela própria; nunca mexe em chaves de API.

export const NODE_MINIMO = '22.22.2' // exigido pelo OmniRoute

const RE_VERSAO = /(\d+)\.(\d+)\.(\d+)/
export const versaoDe = (texto: string): string | null => { const m = RE_VERSAO.exec(texto); return m ? `${m[1]}.${m[2]}.${m[3]}` : null }
export function compararVersoes(a: string, b: string): number {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) { const d = (pa[i] ?? 0) - (pb[i] ?? 0); if (d !== 0) return d }
  return 0
}

export interface EstadoComponentes {
  node: { versao: string | null; ok: boolean; minimo: string }
  omniroute: { versao: string | null; maisNova: string | null; atualizar: boolean }
  /** Falta algo, algo está velho ou há versão nova: vale oferecer "Instalar ou atualizar". */
  precisaAcao: boolean
}

/** Decide, só com as versões encontradas, o que está faltando. Lógica pura. */
export function avaliar(node: string | null, omni: string | null, omniMaisNova: string | null): EstadoComponentes {
  const nodeOk = !!node && compararVersoes(node, NODE_MINIMO) >= 0
  const atualizar = !!omni && !!omniMaisNova && compararVersoes(omni, omniMaisNova) < 0
  return { node: { versao: node, ok: nodeOk, minimo: NODE_MINIMO }, omniroute: { versao: omni, maisNova: omniMaisNova, atualizar }, precisaAcao: !nodeOk || !omni || atualizar }
}

function saida(cmd: string, args: string[], limite = 15000): Promise<string> {
  return new Promise((resolver) => {
    execFile(cmd, args, { shell: true, timeout: limite, windowsHide: true, maxBuffer: 1024 * 1024 }, (e, out) => resolver(e ? '' : String(out)))
  })
}

export async function lerEstado(comRede: boolean): Promise<EstadoComponentes> {
  const [node, omni] = await Promise.all([saida('node', ['-v'], 8000), saida('omniroute', ['--version'], 20000)])
  const maisNova = comRede ? versaoDe((await saida('npm', ['view', 'omniroute', 'dist-tags.latest'], 15000)).trim().split('\n').pop() ?? '') : null
  return avaliar(versaoDe(node), versaoDe(omni.trim().split('\n').pop() ?? ''), maisNova)
}

function caminhoDoScript(): string {
  return app.isPackaged ? join(process.resourcesPath, 'componentes', 'instalar-componentes.ps1') : join(app.getAppPath(), 'scripts', 'instalar-componentes.ps1')
}

interface Progresso { rodando: boolean; linhas: string[]; resultado: { ok: boolean; mensagem: string } | null }
const progresso: Progresso = { rodando: false, linhas: [], resultado: null }
const MAX_LINHAS = 60

function rodarScript(): Promise<void> {
  return new Promise((resolver) => {
    progresso.rodando = true; progresso.linhas = []; progresso.resultado = null
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', caminhoDoScript()], { windowsHide: true })
    const limite = setTimeout(() => { p.kill() }, 20 * 60 * 1000)
    let resto = ''
    const linha = (l: string): void => {
      const t = l.replace(/\x1b\[[0-9;]*m/g, '').trim()
      if (!t) return
      if (t.startsWith('RESULTADO ')) { try { const j = JSON.parse(t.slice(10)) as { ok: boolean; mensagem: string }; progresso.resultado = { ok: !!j.ok, mensagem: String(j.mensagem ?? '') } } catch { /* linha ruim */ } return }
      progresso.linhas = [...progresso.linhas, t].slice(-MAX_LINHAS)
    }
    const aoDado = (d: Buffer): void => { resto += d.toString('utf-8'); const partes = resto.split(/\r?\n/); resto = partes.pop() ?? ''; partes.forEach(linha) }
    p.stdout.on('data', aoDado); p.stderr.on('data', aoDado)
    p.on('close', (codigo) => {
      clearTimeout(limite); if (resto) linha(resto)
      if (!progresso.resultado) progresso.resultado = { ok: codigo === 0, mensagem: codigo === 0 ? 'Concluído.' : 'O instalador de componentes terminou com erro.' }
      progresso.rodando = false; resolver()
    })
    p.on('error', (e) => { clearTimeout(limite); progresso.resultado = { ok: false, mensagem: `Não consegui iniciar o PowerShell: ${e.message}` }; progresso.rodando = false; resolver() })
  })
}

export function registrarComponentes(ctx: ModuloContexto): void {
  ctx.ipc.tratar('ia:componentes-estado', async (comRede): Promise<Resultado<{ estado: EstadoComponentes; progresso: Progresso }>> => {
    try { return { ok: true, dados: { estado: await lerEstado(comRede === true), progresso } } } catch (e) { return { ok: false, erro: e instanceof Error ? e.message : String(e) } }
  })
  ctx.ipc.tratar('ia:componentes-progresso', (): Resultado<Progresso> => ({ ok: true, dados: progresso }))
  ctx.ipc.tratar('ia:componentes-instalar', async (): Promise<Resultado<null>> => {
    if (progresso.rodando) return { ok: false, erro: 'Já está instalando.' }
    if (!existsSync(caminhoDoScript())) return { ok: false, erro: 'O instalador de componentes não está junto do app.' }
    const ok = await pedirConfirmacao({
      titulo: 'Instalar ou atualizar os componentes da IA',
      detalhe: ['Será instalado ou atualizado, na versão estável mais recente:', `  • Node.js ${NODE_MINIMO} ou mais novo (baixado de nodejs.org e conferido por SHA-256, sem precisar de administrador)`, '  • OmniRoute (npm install -g omniroute@latest)', '', 'Não grava chaves de API e não inicia servidores.', 'Pode levar alguns minutos e precisa de internet.'].join('\n')
    })
    if (!ok) return { ok: false, erro: 'Cancelado.' }
    void rodarScript() // segue em segundo plano; a tela acompanha por ia:componentes-progresso
    return { ok: true, dados: null }
  })
}
