export default function Button({ variant = 'secondary', size, block, className = '', children, ...props }) {
  const cls = ['btn', `btn-${variant}`, size === 'sm' ? 'btn-sm' : '', block ? 'btn-block' : '', className]
    .filter(Boolean).join(' ');
  return <button className={cls} {...props}>{children}</button>;
}
