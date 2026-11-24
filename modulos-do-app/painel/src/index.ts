import type { ModuloCodigo } from '@memoritrix/nucleo-modulos'
import manifesto from '../module.json'
import { registrarSinapse } from './sinapse'

export { manifesto }

/** Parte do módulo que roda no processo principal. */
let parar: (() => void) | null = null
export const codigo: ModuloCodigo = {
  ativar(ctx) {
    parar = registrarSinapse(ctx)
  },
  desativar() {
    parar?.()
    parar = null
  }
}
