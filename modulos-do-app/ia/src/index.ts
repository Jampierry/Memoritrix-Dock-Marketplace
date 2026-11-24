import type { ModuloCodigo } from '@memoritrix/nucleo-modulos'
import manifesto from '../module.json'
import { registrarChat } from './chat'
import { registrarComponentes } from './componentes'
import { registrarIA } from './ia'
import { registrarVoz } from './voz'

export { manifesto }
export { definirAnfitriao } from './ferramentas'

/** Parte do módulo que roda no processo principal. */
export const codigo: ModuloCodigo = {
  ativar(ctx) {
    registrarIA(ctx)
    registrarChat(ctx)
    registrarComponentes(ctx)
    registrarVoz(ctx)
  }
}
