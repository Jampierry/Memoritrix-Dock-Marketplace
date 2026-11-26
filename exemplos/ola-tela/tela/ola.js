// Tela do módulo (ESM já pronto, sem JSX): recebe a api v1 e devolve o componente.
export default function criar(api) {
  const { React } = api
  const h = React.createElement
  return function OlaTela() {
    const [hora, setHora] = React.useState('')
    const [erro, setErro] = React.useState('')
    const pedir = () => {
      api.invocar('ola-tela:hora').then((r) => { setErro(''); setHora(String(r && r.dados !== undefined ? r.dados : JSON.stringify(r))) }).catch((e) => setErro(String(e && e.message ? e.message : e)))
    }
    return h('div', { style: { margin: '12px 0', padding: '12px 14px', border: '1px solid var(--accent)', borderRadius: 10 } },
      h('b', null, 'Olá, Tela! (veio do marketplace, v1.0.1)'),
      h('div', { style: { marginTop: 8 } }, h('button', { onClick: pedir }, 'Ver a hora no processo principal'), ' ', hora && h('span', null, hora), erro && h('small', { role: 'alert' }, erro))
    )
  }
}
