import { app, BrowserWindow } from 'electron'
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ModuloContexto } from '@memoritrix/nucleo-modulos'
import { extrairZip } from '../../marketplace/src/zip'
import type { Resultado } from '@shared/tipos'
import { pedirConfirmacao } from './ferramentas'
import { BASE, garantirGateway } from './omniroute'
import { configVoz, limparTranscricao, wavValido, type ConfigVoz } from './voz-texto'

// Voz do Memorix: reconhecimento de fala. Motor local = whisper.cpp (programa e modelo baixados uma vez, cada arquivo conferido por SHA-256
// fixo aqui no código); motor nuvem = transcrição do OmniRoute. O áudio só é gravado pela interface quando o usuário aciona a voz.

const WHISPER = {
  url: 'https://github.com/ggml-org/whisper.cpp/releases/download/b5907/whisper-bin-x64.zip',
  sha256: 'ecca07b277d943e9b9f4712856a144b857271a6b333104e511e1988e80db582b',
  tamanho: 9168428
}
const MODELO = {
  nome: 'ggml-base.bin',
  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
  sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe',
  tamanho: 147951465
}
const HOSTS = [/^github\.com$/, /^objects\.githubusercontent\.com$/, /^release-assets\.githubusercontent\.com$/, /^huggingface\.co$/, /(^|\.)hf\.co$/, /(^|\.)huggingface\.co$/]

const hostPermitido = (u: string): boolean => {
  try { const x = new URL(u); return x.protocol === 'https:' && !x.username && !x.password && !x.port && HOSTS.some((r) => r.test(x.hostname)) } catch { return false }
}

const pasta = (): string => join(app.getPath('userData'), 'voz')
const exe = (): string => join(pasta(), 'whisper', 'Release', 'whisper-cli.exe')
const modelo = (): string => join(pasta(), MODELO.nome)

export const localInstalado = (): boolean => existsSync(exe()) && existsSync(modelo()) && statSync(modelo()).size === MODELO.tamanho

interface Progresso { rodando: boolean; etapa: string; pct: number; erro: string | null; pronto: boolean }
const progresso: Progresso = { rodando: false, etapa: '', pct: 0, erro: null, pronto: false }

/** Baixa para um arquivo, só de hosts permitidos (cada redirecionamento conferido), e confere o SHA-256 antes de aceitar. */
async function baixarArquivo(url: string, destino: string, sha256: string, tamanho: number, etapa: string): Promise<void> {
  let atual = url
  let r: Response | null = null
  for (let salto = 0; salto < 6; salto++) {
    if (!hostPermitido(atual)) throw new Error('Endereço de download fora dos servidores esperados; recusado.')
    const resp = await fetch(atual, { redirect: 'manual', signal: AbortSignal.timeout(30 * 60 * 1000), headers: { 'user-agent': 'MemoritrixDock-voz' } })
    const prox = resp.headers.get('location')
    if (resp.status >= 300 && resp.status < 400 && prox) { atual = new URL(prox, atual).toString(); continue }
    if (!resp.ok || !resp.body) throw new Error(`O servidor respondeu ${resp.status}.`)
    r = resp
    break
  }
  if (!r?.body) throw new Error('Redirecionamentos demais.')
  const parcial = `${destino}.parte`
  const hash = createHash('sha256')
  let lido = 0
  const origem = Readable.fromWeb(r.body as never)
  origem.on('data', (c: Buffer) => {
    lido += c.length
    if (lido > tamanho + 1024) origem.destroy(new Error('Arquivo maior do que o esperado.'))
    hash.update(c)
    progresso.etapa = etapa
    progresso.pct = Math.min(99, Math.round((lido / tamanho) * 100))
  })
  try {
    await pipeline(origem, createWriteStream(parcial))
    if (lido !== tamanho || hash.digest('hex') !== sha256) throw new Error('O arquivo baixado não confere com o esperado (SHA-256). Nada foi instalado.')
    renameSync(parcial, destino)
  } catch (e) {
    rmSync(parcial, { force: true })
    throw e
  }
}

async function instalarLocal(): Promise<void> {
  progresso.rodando = true; progresso.erro = null; progresso.pronto = false; progresso.pct = 0
  try {
    mkdirSync(pasta(), { recursive: true })
    if (!existsSync(exe())) {
      const zip = join(pasta(), 'whisper.zip')
      await baixarArquivo(WHISPER.url, zip, WHISPER.sha256, WHISPER.tamanho, 'Baixando o programa do Whisper')
      progresso.etapa = 'Extraindo'
      rmSync(join(pasta(), 'whisper'), { recursive: true, force: true })
      extrairZip(readFileSync(zip), join(pasta(), 'whisper'))
      rmSync(zip, { force: true })
      if (!existsSync(exe())) throw new Error('O pacote do Whisper não trouxe o whisper-cli.exe.')
    }
    if (!existsSync(modelo()) || statSync(modelo()).size !== MODELO.tamanho) await baixarArquivo(MODELO.url, modelo(), MODELO.sha256, MODELO.tamanho, 'Baixando o modelo de voz (150 MB)')
    progresso.pronto = true; progresso.pct = 100; progresso.etapa = 'Pronto'
  } catch (e) {
    progresso.erro = e instanceof Error ? e.message : String(e)
  } finally {
    progresso.rodando = false
  }
}

function transcreverLocal(wav: Uint8Array): Promise<Resultado<string>> {
  if (!localInstalado()) return Promise.resolve({ ok: false, erro: 'O reconhecimento de voz local não está instalado. Instale em Ajustes > IA > Voz.' })
  const arq = join(app.getPath('temp'), `memorix-voz-${randomUUID()}.wav`)
  writeFileSync(arq, wav)
  return new Promise((resolver) => {
    const threads = String(Math.max(2, Math.min(8, Math.floor((process.env['NUMBER_OF_PROCESSORS'] ? Number(process.env['NUMBER_OF_PROCESSORS']) : 4) / 2))))
    execFile(exe(), ['-m', modelo(), '-f', arq, '-l', 'pt', '-nt', '-np', '-t', threads], { timeout: 90000, windowsHide: true, maxBuffer: 4 * 1024 * 1024, cwd: join(pasta(), 'whisper', 'Release') }, (e, out) => {
      rmSync(arq, { force: true })
      if (e) resolver({ ok: false, erro: 'O Whisper local falhou ao transcrever.' })
      else resolver({ ok: true, dados: limparTranscricao(String(out)) })
    })
  })
}

async function transcreverNuvem(wav: Uint8Array, cfg: ConfigVoz): Promise<Resultado<string>> {
  if (!(await garantirGateway())) return { ok: false, erro: 'O OmniRoute não está no ar. Confira Ajustes > IA.' }
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'fala.wav')
  form.append('model', cfg.modeloNuvem)
  form.append('language', 'pt')
  try {
    const r = await fetch(`${BASE}/audio/transcriptions`, { method: 'POST', body: form, signal: AbortSignal.timeout(60000) })
    if (!r.ok) return { ok: false, erro: `A transcrição na nuvem falhou (${r.status}). Confira o modelo e as chaves em Ajustes > IA, ou use o motor local.` }
    const j = (await r.json()) as { text?: unknown }
    return { ok: true, dados: limparTranscricao(typeof j.text === 'string' ? j.text : '') }
  } catch {
    return { ok: false, erro: 'Não consegui falar com o OmniRoute para transcrever.' }
  }
}

export function registrarVoz(ctx: ModuloContexto): void {
  const ler = (): ConfigVoz => configVoz(ctx.dados.lerJson<unknown>('ia-voz.json', {}))
  const estado = (): { config: ConfigVoz; localInstalado: boolean; progresso: Progresso } => ({ config: ler(), localInstalado: localInstalado(), progresso })

  ctx.ipc.tratar('ia:voz-estado', (): Resultado<ReturnType<typeof estado>> => ({ ok: true, dados: estado() }))
  ctx.ipc.tratar('ia:voz-salvar', (parcial): Resultado<ReturnType<typeof estado>> => {
    ctx.dados.gravarJson('ia-voz.json', configVoz({ ...ler(), ...(parcial && typeof parcial === 'object' ? parcial : {}) }))
    for (const j of BrowserWindow.getAllWindows()) if (!j.isDestroyed()) j.webContents.send('voz:mudou')
    return { ok: true, dados: estado() }
  })
  ctx.ipc.tratar('ia:voz-instalar', async (): Promise<Resultado<null>> => {
    if (progresso.rodando) return { ok: false, erro: 'Já está baixando.' }
    const ok = await pedirConfirmacao({
      titulo: 'Instalar o reconhecimento de voz local',
      detalhe: ['Será baixado, uma única vez (cerca de 160 MB):', '  • whisper.cpp (programa de reconhecimento de fala), do GitHub oficial', '  • modelo "base" do Whisper, do Hugging Face', '', 'Cada arquivo é conferido por SHA-256 antes de ser usado. Roda só neste computador, sem enviar áudio para a internet.'].join('\n')
    })
    if (!ok) return { ok: false, erro: 'Cancelado.' }
    void instalarLocal()
    return { ok: true, dados: null }
  })
  ctx.ipc.tratar('ia:voz-transcrever', async (bytes): Promise<Resultado<string>> => {
    if (!(bytes instanceof Uint8Array) || !wavValido(bytes)) return { ok: false, erro: 'Áudio inválido.' }
    const cfg = ler()
    return cfg.motor === 'nuvem' ? transcreverNuvem(bytes, cfg) : transcreverLocal(bytes)
  })
}
