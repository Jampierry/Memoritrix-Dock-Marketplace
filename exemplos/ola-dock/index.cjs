// Módulo de exemplo. O app exige que o arquivo exporte `codigo` com `ativar(ctx)` (e, se quiser, `desativar()`).
exports.codigo = {
  ativar(ctx) {
    // Canal de teste: o nome começa com "<id>:" e exige a permissão "config".
    ctx.ipc.tratar('ola-dock:ola', () => ({ ok: true, dados: 'Olá! Este módulo veio do marketplace.' }))
    // Serviço que outros módulos podem usar.
    ctx.servicos.registrar('ola-dock.saudacao', () => 'Olá do marketplace!')
  },
  desativar() {}
}
