import { Segmented, Tooltip } from 'antd';
import { NUMERALS_LABELS, type Numerals, setNumerals, useNumerals } from '../utils/numerals';

export default function NumeralsControl() {
  const numerals = useNumerals();
  return (
    <Tooltip title="شكل الأرقام المعروضة">
      <Segmented
        size="small"
        value={numerals}
        onChange={(v) => setNumerals(v as Numerals)}
        options={[
          { value: 'arabic', label: NUMERALS_LABELS.arabic },
          { value: 'latin', label: NUMERALS_LABELS.latin },
        ]}
        {...{ 'aria-label': 'شكل الأرقام' }}
      />
    </Tooltip>
  );
}
