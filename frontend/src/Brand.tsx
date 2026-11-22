export const brandTitle = 'POS powered by Hiremath Web Studio';

export function Brand() {
  return <>
    <img className="brand-mark pos-brand-mark" src="/pos-hotel-logo.png" alt="" />
    <span className="brand-type pos-brand-type"><strong>POS</strong><small>powered by Hiremath Web Studio</small></span>
  </>;
}