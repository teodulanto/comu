# Auditoria del motor de dictado

> Documento historico de decision. La migracion recomendada a `whisper.cpp` ya fue implementada en Comu 0.3.0.

Fecha: 2026-08-25

## Objetivo

Elegir un motor local que reduzca la espera, preserve mejor textos largos y siga siendo sencillo de instalar, publicar y mantener como proyecto open source. Esta auditoria no modifica la aplicacion instalada.

## Resumen ejecutivo

La recomendacion es conservar Tauri y React, retirar Transformers.js del camino principal de transcripcion y adoptar `whisper.cpp` como motor local. `faster-whisper` queda como adaptador futuro, no como dependencia base.

La decision no se apoya solo en benchmarks publicados. En este equipo, `whisper.cpp` proceso 72.7 segundos de audio en:

| Configuracion | Tiempo | RTF | Descarga del modelo |
| --- | ---: | ---: | ---: |
| CPU, base Q5, 4 hilos | 12.22 s | 0.17 | 59.7 MB |
| CPU, base Q5, 8 hilos | 11.85 s | 0.16 | 59.7 MB |
| BLAS, base Q5, VAD | 10.23 s | 0.14 | 59.7 MB + VAD |
| CPU, small Q5, 4 hilos | 35.16 s | 0.48 | 190 MB |
| BLAS, small Q5, VAD | 20.06 s | 0.28 | 190 MB + VAD |

`RTF` significa factor de tiempo real. Un valor de 0.14 equivale aproximadamente a 8.4 segundos de procesamiento por cada minuto de audio. La version actual observada por el usuario esta cerca de 1.0.

## Equipo auditado

- CPU: Intel Core i5-8300H, 4 nucleos y 8 hilos.
- GPU dedicada: NVIDIA GeForce GTX 1050, aproximadamente 4 GB de VRAM.
- GPU integrada: Intel UHD Graphics 630.
- Controlador NVIDIA reportado por Vulkan: 425.46.
- `nvidia-smi` no esta disponible, por lo que CUDA moderno no puede asumirse.

La CPU es suficiente para `whisper.cpp base` y permite `small` por debajo de tiempo real. La GPU podria aprovecharse mas adelante, pero no debe ser un requisito para que la aplicacion funcione.

## Estado actual

La aplicacion usa:

- Tauri 2 para proceso, bandeja, atajo e instalador.
- React para configuracion e indicador.
- `MediaRecorder` y `AudioContext` para capturar y convertir audio.
- Transformers.js y modelos ONNX dentro de WebView2.
- Bloques de 30 segundos con 5 segundos de superposicion.
- Insercion final mediante `SendInput` en la ventana activa.

### Problemas confirmados

1. La transcripcion comienza solo despues de detener la grabacion.
2. No se informa si se usa WebGPU o si hubo retorno silencioso a WebAssembly.
3. Los bloques se unen sin una etapa de reconstruccion global de puntuacion.
4. No existe historial durable del audio o del texto.
5. El texto se inserta en la ventana activa al finalizar, no necesariamente en la ventana original.
6. Los modelos ONNX descargados son grandes. La combinacion actual de `small` usa aproximadamente 353 MB de codificador FP32 y 233 MB de decodificador Q4, sin contar archivos auxiliares.
7. Ya hubo una regresion causada por una configuracion de precision incompatible con Whisper. Esto demuestra que seguir ajustando el backend web tiene un coste de riesgo alto.
8. `npm audit --omit=dev` reporta dos vulnerabilidades altas heredadas de `sharp` a traves de Transformers.js, sin correccion disponible en la rama instalada. La aplicacion no usa las funciones de imagen de `sharp`, pero retirar Transformers.js tambien reduce esta superficie de dependencias.

## Peso real del proyecto

- Codigo publicable, lockfiles e iconos: aproximadamente 0.53 MB.
- Instalador 0.1.6: aproximadamente 9.41 MB.
- Carpeta de trabajo observada: varios GB por artefactos de Rust, no por el producto.
- Modelo `whisper.cpp base-q5_1`: 59.7 MB.
- Modelo `whisper.cpp small-q5_1`: 190 MB.
- Modelo VAD Silero: 0.86 MB.
- Binario oficial CPU de `whisper.cpp`: archivo comprimido de aproximadamente 8 MB.
- Variante BLAS: archivo comprimido de aproximadamente 20 MB; OpenBLAS ocupa cerca de 49 MB instalado.

Los modelos no deben incluirse en Git. Deben descargarse bajo demanda, verificarse con SHA-256 y almacenarse en el directorio de datos de la aplicacion.

La configuracion actual de `.gitignore` excluye `target/`, `dist/`, `node_modules/` y Vite, pero no excluye carpetas como `target-build-013`, `target-ui-test` o `target-audio-test`. Eso debe corregirse antes de inicializar el repositorio.

## Comparacion de alternativas

| Criterio | Transformers.js actual | whisper.cpp | faster-whisper |
| --- | --- | --- | --- |
| Velocidad en este equipo | Cerca de RTF 1.0 observado | RTF 0.14-0.48 medido | No medido localmente |
| Integracion con Tauri | Ya existe | Natural mediante sidecar o C API | Requiere Python/CTranslate2 o sidecar grande |
| CPU sin requisitos externos | Si | Si | Si, con runtime Python empaquetado |
| GPU multiplataforma | WebGPU experimental | CUDA, Vulkan, OpenVINO, ROCm | Principalmente CUDA |
| VAD | No integrado | Integrado | Silero integrado |
| Streaming | Debe construirse | Ejemplo y API disponibles | Ecosistema maduro de streaming |
| Tamano operativo | ONNX relativamente grande | Modelos GGML compactos | Runtime y modelos CTranslate2 mayores |
| Licencia principal | Apache-2.0 | MIT | MIT |
| Complejidad de soporte | Media, con variacion de WebView/GPU | Baja-media | Alta en Windows por Python y CUDA |

`faster-whisper` es tecnicamente valido y sus autores publican mejoras de hasta 4 veces frente a Whisper original. Sin embargo, sus versiones actuales de GPU requieren CUDA 12 y cuDNN 9. Para este proyecto eso aumentaria el instalador, la matriz de compatibilidad y el soporte al usuario sin aportar una ventaja demostrada frente al resultado local de `whisper.cpp`.

## Resultado de calidad

La muestra sintetica permite comparar velocidad y detectar omisiones, pero no reemplaza pruebas con voz humana.

- `base Q5` con VAD conservo casi todo el contenido, incluidas palabras tecnicas, pero cometio sustituciones como `dictado` por `dedicado` y perdio el signo interrogativo.
- `small Q5` reconocio mejor algunas palabras, pero omitio un tramo largo en esta muestra.
- VAD mejoro la cobertura y el tiempo, especialmente con `small`, pero no elimino todas las omisiones.

Conclusion: elegir solo por tamano de modelo es incorrecto. La segmentacion, el contexto anterior, los umbrales de confianza y la recuperacion de segmentos fallidos deben formar parte del producto.

## Decision

### Motor

Adoptar `whisper.cpp` como motor principal.

### Perfil inicial

- `base Q5` como perfil rapido y respaldo estable.
- `small Q5` como candidato de precision, sujeto a validacion con voz real.
- VAD Silero con configuracion conservadora y superposicion.
- CPU/BLAS como linea base soportada.
- Aceleracion Vulkan o CUDA como mejora opcional posterior, nunca como requisito.

### Integracion

Mantener Tauri y la interfaz actuales. Introducir una frontera `TranscriptionEngine` para que la aplicacion no dependa directamente de un motor concreto.

Primero se usara `whisper.cpp` como sidecar versionado. Es la via de menor riesgo: permite sustituir el motor web sin reescribir simultaneamente microfono, interfaz, bandeja y atajos. Una integracion directa por C API solo se justificara despues de demostrar una necesidad real de streaming persistente o menor sobrecarga.

## Arquitectura objetivo

```text
Atajo global
  -> captura de audio existente
  -> archivo WAV temporal y durable
  -> cola local de trabajos
  -> adaptador TranscriptionEngine
  -> whisper.cpp + VAD + contexto
  -> ensamblador de segmentos
  -> correcciones y puntuacion limitada
  -> historial local + portapapeles
  -> insercion en la ventana original o confirmacion del usuario
```

El audio se guarda antes de transcribir. Un fallo del modelo o un cambio de ventana nunca debe destruir el dictado.

## Distribucion open source

1. El repositorio contiene codigo, manifiestos, lockfiles, pruebas y scripts de descarga; no contiene modelos ni artefactos de compilacion.
2. El instalador contiene la aplicacion y el runtime CPU compatible.
3. En el primer inicio se descarga el modelo elegido con progreso, reanudacion, URL versionada y SHA-256.
4. La pantalla de configuracion muestra espacio requerido y permite eliminar o cambiar modelos.
5. Se incluye `THIRD_PARTY_NOTICES.md` con licencias de Whisper, whisper.cpp, Silero, OpenBLAS y dependencias.
6. CI genera instaladores reproducibles para Windows y publica hashes.
7. La primera version publica soporta Windows. Linux y macOS se agregan solo cuando existan builds y pruebas reales.

## Ruta de migracion con puertas de salida

### Puerta 1: corpus de aceptacion

Crear 10 grabaciones reales en espanol: frases cortas, 1 minuto, 3 minutos, pausas, nombres propios y puntuacion. Conservar audio y texto esperado fuera del repositorio publico si contienen voz privada.

No se cambia el motor hasta tener este corpus.

### Puerta 2: adaptador whisper.cpp por lotes

Conectar `base Q5` y `small Q5` sin tocar la interfaz ni el atajo.

Criterios para avanzar:

- RTF p95 menor o igual a 0.35 en este equipo.
- Ninguna omision continua mayor a 2 segundos.
- Cero perdida de audio o texto ante error.
- Memoria maxima menor a 1.5 GB con el perfil predeterminado.
- Descarga predeterminada menor a 250 MB.

Si no cumple, se detiene la migracion y se revisan los datos; no se agregan optimizaciones aleatorias.

### Puerta 3: durabilidad y foco

Agregar cola, historial, portapapeles y captura de la ventana original. Esta fase es obligatoria antes de soportar dictados largos.

### Puerta 4: transcripcion incremental

Procesar segmentos cerrados por VAD mientras el usuario habla. Solo se implementa si la puerta 2 demuestra RTF menor que 0.5. El objetivo es que al detener queden menos de 5 segundos de espera.

### Puerta 5: puntuacion

Evaluar, en este orden:

1. Contexto entre segmentos e `initial_prompt`.
2. Union por marcas de tiempo y confianza.
3. Comandos explicitos como `punto` y `nuevo parrafo`.
4. Restaurador local limitado a puntuacion y mayusculas.

No se incorpora un LLM general hasta demostrar que no cambia palabras ni significado.

## Riesgos restantes

- Una voz sintetica no predice completamente la precision con voz humana.
- La GTX 1050 podria requerir actualizar controladores antes de usar CUDA o Vulkan moderno.
- Los perfiles `base` y `small` pueden comportarse de forma diferente segun acento, microfono y ruido.
- El sidecar exige publicar binarios por plataforma y verificar su procedencia.
- La insercion en aplicaciones elevadas puede estar limitada por las protecciones de Windows.

## Fuentes primarias

- [OpenAI Whisper](https://github.com/openai/whisper)
- [whisper.cpp](https://github.com/ggml-org/whisper.cpp)
- [faster-whisper](https://github.com/SYSTRAN/faster-whisper)
- [Modelos GGML de whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp/tree/main)
- [Silero VAD para whisper.cpp](https://huggingface.co/ggml-org/whisper-vad)
