import { execFile, execFileSync, spawn } from 'node:child_process'

// OmniRoute: o gateway de IA local (CLI `omniroute` e porta local). Compartilhado pela fila de IAs e pelo chat do Memorix.

export const PORTA = 20128
export const COMBO = 'memoritrix-auto'
// 127.0.0.1 (e não "localhost"): o servidor escuta só em IPv4 local e o Windows pode resolver localhost para IPv6.
export const RAIZ = `http://127.0.0.1:${PORTA}`
export const BASE = `${RAIZ}/v1`

/** Roda o CLI do OmniRoute. Os argumentos vêm só do catálogo fixo, nunca da interface. */
export function cli(args: string[], entrada?: string, limite = 30000): Promise<{ ok: boolean; saida: string }> {
  if (args[0] !== 'usage') ultimoUso = Date.now() // consultar o uso não conta como uso da IA (senão a vigia nunca deixaria o servidor ocioso)
  return new Promise((resolver) => {
    // O servidor escuta só nesta máquina: por padrão o OmniRoute abre em todas as interfaces e qualquer aparelho da rede usaria as chaves.
    const env = { ...process.env, OMNIROUTE_SERVER_HOST: process.env.OMNIROUTE_SERVER_HOST ?? '127.0.0.1', OMNIROUTE_BASE_URL: RAIZ }
    const p = execFile('omniroute', args, { shell: true, env, timeout: limite, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (e, out, err) =>
      resolver({ ok: !e, saida: String(out || err || '').replace(/\x1b\[[0-9;]*m/g, '') })
    )
    if (entrada !== undefined) p.stdin?.end(entrada)
  })
}

export async function gatewayNoAr(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/models`, { signal: AbortSignal.timeout(1500) })
    return r.status < 500
  } catch {
    return false
  }
}


// O servidor do OmniRoute precisa rodar com um console OCULTO nosso. Iniciado em modo --daemon (sem console), cada consulta de gerenciamento
// faz o servidor chamar `REG QUERY` e o Windows Terminal abre uma janela que aparece e some. Por isso o dock sobe o servidor ele mesmo e,
// se encontra um servidor antigo no ar, troca por um oculto uma única vez (a marca fica guardada para não reiniciar de novo).
let guardar: { ler: () => boolean; gravar: () => void } | null = null
export function definirMarcaServidorOculto(m: { ler: () => boolean; gravar: () => void }): void { guardar = m }

// Interruptor do usuário (Ajustes > IA): com o OmniRoute desligado, o dock não o sobe sozinho nem sob demanda.
let permitido = true
export function permitirServidor(v: boolean): void { permitido = v }
export const servidorPermitido = (): boolean => permitido

// O servidor é do dock (ele o sobe oculto) e pesa ~340 MB: sai junto com o app e também quando fica ocioso (sobe de novo no próximo uso).
let pidServidor = 0
let subiuAqui = false
let ultimoUso = Date.now()
let vigia: ReturnType<typeof setInterval> | null = null
const OCIOSO_MS = 30 * 60 * 1000

/** Encerra o servidor do OmniRoute que o dock criou (ou trocou por um dele), com todos os processos filhos. Chama-se síncrono ao sair. */
export function encerrarServidor(forcar = false): void {
  if (process.env['DOCK_DADOS'] || process.platform !== 'win32') return // com pasta de dados de teste, não mexe no servidor de ninguém
  if (!forcar && !(subiuAqui || guardar?.ler())) return // forcar: o usuário mandou desligar pelo interruptor
  if (vigia) { clearInterval(vigia); vigia = null }
  try { if (pidServidor) execFileSync('taskkill', ['/PID', String(pidServidor), '/T', '/F'], { timeout: 8000, windowsHide: true, stdio: 'ignore' }) } catch { /* já tinha saído */ }
  try {
    // O OmniRoute tem um processo "launcher" que recria o servidor se ele morrer: encerra primeiro o launcher (com a árvore toda) e,
    // por garantia, quem ainda escuta na porta (inclusive um servidor que sobrou de uma sessão anterior).
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*omniroute*' -and ($_.CommandLine -like '* serve *' -or $_.CommandLine -like '*server-ws*') } | ForEach-Object { taskkill /PID $_.ProcessId /T /F | Out-Null }; ` +
      `Get-NetTCPConnection -LocalPort ${PORTA} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue; if ($p -and $p.ProcessName -eq 'node') { taskkill /PID $p.Id /T /F | Out-Null } }`],
      { timeout: 15000, windowsHide: true, stdio: 'ignore' })
  } catch { /* nada escutando */ }
  pidServidor = 0
  subiuAqui = false
}

/** Fora do uso do dock, só desliga se ninguém (nem OpenBot ou outra ferramenta) pediu nada ao gateway no período ocioso. */
async function vigiarOcioso(): Promise<void> {
  if (Date.now() - ultimoUso < OCIOSO_MS) return
  const r = await cli(['--output', 'json', 'usage', 'logs', '--limit', '1'], undefined, 20000)
  const m = /[[{][\s\S]*[\]}]/.exec(r.saida)
  let ultimoPedido = 0
  if (m) { try { const l = (JSON.parse(m[0]) as { timestamp?: string }[])[0]; ultimoPedido = l?.timestamp ? new Date(l.timestamp).getTime() : 0 } catch { /* formato inesperado */ } }
  if (Date.now() - Math.max(ultimoUso, ultimoPedido) >= OCIOSO_MS) encerrarServidor()
}
function ligarVigia(): void {
  if (vigia) return
  vigia = setInterval(() => { void vigiarOcioso() }, 10 * 60 * 1000)
  vigia.unref()
}

function subirOculto(): boolean {
  try {
    const env = { ...process.env, OMNIROUTE_SERVER_HOST: process.env.OMNIROUTE_SERVER_HOST ?? '127.0.0.1', OMNIROUTE_BASE_URL: RAIZ }
    const filho = spawn('omniroute', ['serve', '--no-open', '--port', String(PORTA)], { shell: true, env, windowsHide: true, stdio: 'ignore' })
    filho.on('error', () => undefined)
    filho.unref()
    pidServidor = filho.pid ?? 0
    subiuAqui = true
    ligarVigia()
    return true
  } catch { return false }
}

async function esperarNoAr(esperaMs: number): Promise<boolean> {
  const limite = Date.now() + esperaMs
  while (Date.now() < limite) {
    if (await gatewayNoAr()) return true
    await new Promise((ok) => setTimeout(ok, 1000))
  }
  return false
}

let trocando: Promise<void> | null = null
/** Se há um servidor antigo (com console próprio) no ar, troca por um oculto; só na primeira vez. */
export function garantirServidorOculto(): Promise<void> {
  trocando ??= (async () => {
    if (process.env['DOCK_DADOS'] || !guardar || guardar.ler() || !(await gatewayNoAr())) return // com pasta de dados de teste, não mexe no servidor de ninguém
    await cli(['stop'], undefined, 30000)
    await new Promise((ok) => setTimeout(ok, 1500))
    if (subirOculto() && (await esperarNoAr(60000))) guardar.gravar()
  })().finally(() => { trocando = null })
  return trocando
}

/** Garante o gateway no ar: sobe o OmniRoute em segundo plano se preciso e espera ele responder (leva alguns segundos). */
export async function garantirGateway(esperaMs = 90000): Promise<boolean> {
  ultimoUso = Date.now()
  if (!permitido) return gatewayNoAr() // desligado pelo usuário: não sobe sozinho
  if (await gatewayNoAr()) { await garantirServidorOculto(); if (guardar?.ler()) ligarVigia(); return true }
  if (!subirOculto()) return false
  const ok = await esperarNoAr(esperaMs)
  if (ok) guardar?.gravar() // subiu por aqui, já oculto
  return ok
}
