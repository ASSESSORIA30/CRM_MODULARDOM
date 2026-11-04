import type { AppLocale, AppRole } from "@/lib/auth";

const dict = {
  ca: {
    appName: "ModularDom CRM",
    login: "Iniciar sessió",
    email: "Correu electrònic",
    password: "Contrasenya",
    signIn: "Entrar",
    signOut: "Tancar sessió",
    invalidCredentials: "Correu o contrasenya incorrectes.",
    genericError: "No s'ha pogut completar l'operació. Torna-ho a provar.",
    home: "Inici",
    welcome: "Benvingut/da",
    roleLabel: "Rol",
    pendingTitle: "Compte pendent d'activació",
    pendingBody: "El teu usuari existeix però encara no està activat. Direcció l'ha d'activar abans que puguis accedir a cap dada.",
    projectsVisible: "Projectes als quals tens accés",
    noProjects: "Encara no hi ha cap projecte registrat o assignat.",
    usersPending: "Usuaris pendents d'activar",
    nextModules: "Propers mòduls de la FASE 1: clients i leads, Kanban, calendari, tasques i notificacions.",
    newPassword: "Nova contrasenya",
    setPassword: "Desar la contrasenya",
    passwordSaved: "Contrasenya desada.",
    passwordTooShort: "La contrasenya ha de tenir com a mínim 12 caràcters.",
    roles: { direccio: "Direcció", arquitecte: "Arquitecte", constructor: "Constructor", client: "Client" },
  },
  es: {
    appName: "ModularDom CRM",
    login: "Iniciar sesión",
    email: "Correo electrónico",
    password: "Contraseña",
    signIn: "Entrar",
    signOut: "Cerrar sesión",
    invalidCredentials: "Correo o contraseña incorrectos.",
    genericError: "No se ha podido completar la operación. Inténtalo de nuevo.",
    home: "Inicio",
    welcome: "Bienvenido/a",
    roleLabel: "Rol",
    pendingTitle: "Cuenta pendiente de activación",
    pendingBody: "Tu usuario existe pero todavía no está activado. Dirección debe activarlo antes de que puedas acceder a ningún dato.",
    projectsVisible: "Proyectos a los que tienes acceso",
    noProjects: "Todavía no hay ningún proyecto registrado o asignado.",
    usersPending: "Usuarios pendientes de activar",
    nextModules: "Próximos módulos de la FASE 1: clientes y leads, Kanban, calendario, tareas y notificaciones.",
    newPassword: "Nueva contraseña",
    setPassword: "Guardar la contraseña",
    passwordSaved: "Contraseña guardada.",
    passwordTooShort: "La contraseña debe tener como mínimo 12 caracteres.",
    roles: { direccio: "Dirección", arquitecte: "Arquitecto", constructor: "Constructor", client: "Cliente" },
  },
} as const;

export type Dict = (typeof dict)["ca"];

export function t(locale: AppLocale = "ca"): Dict {
  return (dict[locale] ?? dict.ca) as Dict;
}

export function roleName(locale: AppLocale, role: AppRole) {
  return t(locale).roles[role];
}
