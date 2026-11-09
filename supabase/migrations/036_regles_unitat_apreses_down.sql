-- 036 · REVERSIÓ: elimina les regles d'unitat apreses i el registre d'aplicacions.
-- Les tarifes ja reprocessades conserven els valors convertits (i a units.formulas, la fórmula i la regla).
drop table if exists public.tariff_rule_runs;
drop table if exists public.tariff_unit_rules;
