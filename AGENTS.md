# RF simulator guidance

## Carbon y diseño

- Usa la versión instalada de `@carbon/react` y los componentes existentes del proyecto.
- Usa Carbon cuando mejore la interacción, pero no lo fuerces si rompe jerarquía, legibilidad o composición.
- Consulta Storybook o la documentación oficial solo al introducir un componente, resolver una duda o sobrescribir estilos internos.
- Evalúa la interfaz renderizada: accesibilidad, foco, teclado, responsive y estados de carga/error importan tanto como TypeScript.

## Propiedad de la interfaz y del solver

- React es propietario de los controles, el estado visual y el árbol renderizado; Zustand es la fuente de verdad del proyecto y del grafo.
- `RFCanvas` sigue siendo un React Flow controlado: nodos y conexiones cambian mediante acciones del store, no por mutaciones paralelas del DOM.
- `rf.worker.ts` y el motor RF solo reciben entradas serializables y devuelven resultados tipados. No guardan referencias React/DOM ni deciden visibilidad, ARIA o eventos.
- Las APIs imperativas de React Flow, Plotly o del navegador se limitan a efectos de ciclo de vida, medida, foco, portales y limpieza; no crean un segundo propietario.
- Conserva la cancelación del worker, `modelRevision`, la validación del grafo y la separación entre configuración, resultado y persistencia.

## `scientific-ui`

- Corrige primero los problemas específicos de RF dentro de este repositorio.
- Modifica `scientific-ui` solo si la causa pertenece al componente compartido y la corrección debe propagarse.
- Al actualizarlo, cambia conjuntamente `package.json`, `pnpm-lock.yaml` y el tarball de `vendor/`; comprueba que el `.tgz` nuevo quede rastreado por Git.

## Camino rápido

- Atiende una familia concreta por iteración; no conviertas un ajuste del canvas, inspector o plot en una auditoría general.
- Inspecciona el flujo afectado y entrega una iteración visible; amplía el alcance solo si el riesgo o el resultado lo justifican.
- Para cambios visuales localizados, comprueba el flujo afectado y una resolución representativa. No ejecutes suites, benchmarks o validaciones científicas amplias sin motivo.
- Mantén separadas la validez del cálculo RF y la calidad visual salvo que el cambio afecte a ambas.

## Subagentes

- Usa subagentes `gpt-5.6-luna` con razonamiento `max` en paralelo solo para partes independientes cuando mejore claramente velocidad, cobertura o calidad.
- Asigna alcances sin solapamiento, evita que editen el mismo archivo y revisa el diff/estado integrado antes de aceptar su trabajo.
- No uses subagentes para cambios pequeños, secuenciales o fuertemente acoplados.

## Verificación y comandos reales

- Para tareas visuales usa `$browser:control-in-app-browser` cuando esté disponible; inspecciona la pantalla renderizada antes y después.
- Reutiliza `pnpm dev` y HMR; usa `pnpm preview` solo para comprobar la salida de producción.
- Cambio visual/React Flow: navegador interno y resolución relevante; `pnpm test:ui` solo si el escenario browser lo justifica.
- Cambio React/store: `pnpm typecheck` y pruebas afectadas; `pnpm test` ejecuta Vitest y metadatos.
- Cambio worker/motor: `pnpm typecheck` y `pnpm test`; revisa cancelación, errores y unidades.
- Cambio amplio o previo a publicar: `pnpm lint`, `pnpm test` y `pnpm build`.
- No declares verificaciones que no hayas ejecutado.
