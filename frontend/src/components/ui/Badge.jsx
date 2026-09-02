export default function Badge({ tone = 'neutral', children, className = '', ...props }) {
  return <span className={`badge badge--${tone} ${className}`.trim()} {...props}>{children}</span>;
}
