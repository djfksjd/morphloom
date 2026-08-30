interface ParameterControlProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display?: string;
  onChange: (value: number) => void;
}

export function ParameterControl({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: ParameterControlProps) {
  const progress = ((value - min) / (max - min)) * 100;
  return (
    <label className="parameter-control">
      <span className="parameter-label">
        <span>{label}</span>
        <output>{display ?? value.toFixed(2)}</output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--range-progress': `${progress}%` } as React.CSSProperties}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
