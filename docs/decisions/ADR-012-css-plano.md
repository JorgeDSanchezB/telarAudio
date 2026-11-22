# ADR-012 — CSS plano con prefijo propio para la UI

- **Estado:** aceptada.
- **Fecha:** 2026-11-21.

## Contexto

La UI ya arrastra los estilos obligatorios de React Flow y styled-components (peers de waveform-playlist). Decidir el sistema de estilos de nuestros propios componentes.

## Decisión

Una hoja única (`packages/ui/src/estilos/telar.css`) con clases prefijadas `tlr-*` y variables CSS, importada por el paquete de UI. Nada de Tailwind ni CSS modules.

## Problema que resuelve

Cero dependencias de estilos adicionales; el tema (tokens en variables) es legible y sobreescribible; el CSS atraviesa el límite de paquete sin configuración.

## Coste

Disciplina de prefijo y una hoja central (el proyecto es de un solo producto con un solo tema oscuro; el coste real de «CSS global» no aparece hasta haber múltiples temas o productos).

## Alternativas descartada

**Tailwind 4**: excelente, pero añadir un pipeline de estilos al monorepo para una página con ~90 clases no compensa; shadcn/ui aporta componentes que aquí tendríamos que re-estilar casi todos (los componentes clave son de librerías externas con su propio tema).
