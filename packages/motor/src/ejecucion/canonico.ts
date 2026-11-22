/**
 * Serialización canónica (claves ordenadas) para derivar claves de caché
 * estables: el mismo contenido produce siempre el mismo hash, independientemente
 * del orden de inserción de las claves del objeto.
 */

export function jsonCanonico(valor: unknown): string {
  if (valor === null || typeof valor !== 'object') {
    return JSON.stringify(valor) ?? 'null';
  }
  if (Array.isArray(valor)) {
    return `[${valor.map((elemento) => jsonCanonico(elemento)).join(',')}]`;
  }
  const registro = valor as Record<string, unknown>;
  const claves = Object.keys(registro).sort();
  return `{${claves
    .map((clave) => `${JSON.stringify(clave)}:${jsonCanonico(registro[clave])}`)
    .join(',')}}`;
}
