// Código do processo principal do módulo de exemplo com tela.
exports.codigo = {
  ativar(ctx) {
    ctx.ipc.tratar('ola-tela:hora', () => ({ ok: true, dados: new Date().toLocaleTimeString('pt-BR') }))
  },
  desativar() {}
}
