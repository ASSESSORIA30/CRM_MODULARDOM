// Punt d'entrada del motor per a la web (www.modulardom.com/presupuesto). Es compila a
// public/configurador/motor.js amb `npm run build:motor`. Mateix codi que fa servir el CRM.
import { calculate, validateInput } from "./engine";

declare global { interface Window { ModulardomMotor: unknown } }
window.ModulardomMotor = { version: 1, calculate, validateInput };
