# Benchmark de voz real

> Documento de evidencia previo a Comu 0.3.0. Los resultados guiaron la seleccion actual de `small Q5` y `base Q5`.

Fecha: 2026-08-25

## Objetivo

Validar `whisper.cpp` con la voz, el microfono y el tipo de texto que usara realmente la aplicacion. La prueba compara `base Q5` y `small Q5`, con y sin Silero VAD, antes de modificar el motor instalado.

## Corpus

- 9 grabaciones M4A.
- 12 minutos y 19 segundos de audio real.
- 8 grabaciones con texto de referencia: 1,369 palabras.
- 1 grabacion espontanea de 1 minuto y 50 segundos sin texto de referencia.
- Duraciones entre 23 segundos y 2 minutos y 37 segundos.
- Una grabacion formal con vocabulario tecnico, instituciones y siglas.

Los archivos privados permanecen en `MATS/`, que queda excluido por `.gitignore`.

## Metodo

1. Convertir cada M4A a WAV PCM, mono, 16 kHz, sin alterar el original.
2. Ejecutar cada archivo por separado con `whisper.cpp` b4938, OpenBLAS y 4 hilos de CPU.
3. Comparar `ggml-base-q5_1` y `ggml-small-q5_1`.
4. Repetir ambos perfiles con Silero VAD conservador y sin VAD.
5. Calcular WER, cobertura de palabras, tiempo total, RTF y una aproximacion de retencion de puntuacion.
6. Medir memoria maxima sobre una grabacion de 2 minutos y 37 segundos.

`WER` es el porcentaje de sustituciones, omisiones e inserciones frente al texto esperado. Menor es mejor. `RTF` es el tiempo de proceso dividido entre la duracion del audio. Un RTF de 0.45 equivale a unos 27 segundos de proceso por cada minuto grabado.

## Resultados globales

| Perfil | WER | RTF total | RTF p95 | Espera equivalente por minuto | Retencion de puntuacion | RAM maxima |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| base, sin VAD | 9.72% | 0.170 | 0.195 | 10.2 s | 83% | 432 MB |
| base, VAD | 9.64% | 0.162 | 0.182 | 9.7 s | 87% | 432 MB aprox. |
| small, sin VAD | 5.84% | 0.454 | 0.490 | 27.2 s | 76% | 748 MB |
| small, VAD | 4.60% | 0.453 | 0.520 | 27.2 s | 77% | 748 MB aprox. |

El WER medido es conservador. El documento de referencia parece contener el texto preparado, pero no todas las desviaciones realizadas al leer. Por ejemplo, ambos motores reconocen `10 o 30`, mientras el documento dice `10, 20 o 30`. Esas diferencias cuentan como error aunque probablemente describan correctamente el audio.

## Vocabulario tecnico

| Perfil | WER en audio tecnico |
| --- | ---: |
| base, sin VAD | 19.05% |
| base, VAD | 22.02% |
| small, sin VAD | 5.36% |
| small, VAD | 4.76% |

`small` reconocio correctamente expresiones como `diseño instruccional`, `acreditación`, `perfil de egreso`, `UNESCO`, `Accreditation Board for Engineering and Technology`, `ABET`, `metacognición`, `interoperabilidad`, `OpenAI` y `Google DeepMind` en al menos una de las dos configuraciones.

Persisten errores puntuales: `mecanismos` por `mezcanismos`, variaciones en `aseguramiento`, `OECD`, `Anthropic` y una repeticion de `su impacto` con VAD. Son errores corregibles mediante el diccionario personal y la union de segmentos, pero no justifican otro cambio de motor.

## Omisiones y textos largos

No aparecio la perdida de parrafos completos observada en la arquitectura web. En los ocho archivos evaluables, la cantidad de palabras reconocidas quedo entre 96% y 105% del texto de referencia. La diferencia superior a 100% incluye desviaciones al leer, repeticiones y algunas inserciones.

El problema de puntuacion si permanece. En una de las grabaciones largas, `small` mantuvo casi todo el contenido pero encadeno gran parte del texto con comas. Desactivar VAD no lo corrigio. En el audio espontaneo, ambos perfiles produjeron pocas pausas ortograficas. Por tanto, VAD no es la causa principal: la prosodia, los bloques internos de Whisper y la falta de una etapa de ensamblado global explican el resultado.

La cifra de puntuacion de la tabla es solo una aproximacion por cantidad de signos. No demuestra que cada signo este en la posicion correcta.

## Prueba de glosario

Se realizo una prueba controlada con `small` y un prompt tecnico. El ejecutable de Windows produjo codificacion mixta al recibir texto con tildes y el WER empeoro hasta 19.64%. Esta via queda descartada para la primera integracion.

El diccionario personal se aplicara despues de la transcripcion mediante reemplazos limitados y auditables. El uso de `initial_prompt` se reconsiderara solo cuando el sidecar tenga transporte Unicode probado, preferiblemente mediante una API local o entrada estructurada y no argumentos de consola.

## Decision

La migracion a `whisper.cpp` es viable y no requiere rehacer la aplicacion.

- Motor principal: `small Q5`, inicialmente sin segmentacion VAD interna.
- Motor de respaldo y modo rapido: `base Q5`.
- VAD: usar Silero para detectar voz, silencios y puntos de cierre; no delegarle por ahora la reconstruccion final del texto.
- Procesamiento: incremental mientras se graba. `small` tiene RTF cercano a 0.45, suficiente para trabajar en paralelo con la voz y evitar que la espera final crezca linealmente.
- Persistencia: guardar primero el WAV y crear un trabajo local antes de transcribir.
- Salida: historial y portapapeles antes de insertar en la ventana objetivo.
- Puntuacion: ensamblar segmentos usando pausas, marcas de tiempo, superposicion y contexto. No agregar un LLM general en esta fase.

`small` no cumple la puerta original de RTF p95 menor o igual a 0.35 en modo batch. Si toda la transcripcion comenzara despues de detenerse, seguiria esperando unos 27 segundos por minuto. Por eso no se aprueba una sustitucion directa del motor actual: la integracion debe incluir procesamiento incremental desde el inicio.

## Criterios para la implementacion

1. Ningun audio se elimina hasta guardar texto o registrar un error recuperable.
2. El motor permanece cargado en segundo plano para evitar reinicios innecesarios.
3. Los segmentos se procesan mientras continua la grabacion.
4. Al detener, la espera objetivo es menor de 8 segundos para dictados de uno a tres minutos.
5. `small Q5` debe quedar por debajo de 1 GB de RAM en este equipo; la prueba midio 748 MB.
6. Un fallo de `small` permite reintentar el mismo WAV con `base` sin volver a grabar.
7. El resultado nunca depende de que el cursor siga en el mismo lugar.

## Archivos reproducibles

- `scripts/benchmark-whisper-corpus.ps1`: conversion y ejecucion de los cuatro perfiles.
- `scripts/score-transcriptions.py`: WER, cobertura, puntuacion aproximada y RTF.
- `MATS/AUDIO-TRANS/.benchmark/`: WAV normalizados, resultados, JSON, logs y metricas privadas.

## Siguiente etapa aprobada por los datos

Implementar la frontera `TranscriptionEngine`, el sidecar versionado de `whisper.cpp` y el almacenamiento durable de trabajos, conservando la interfaz, el microfono, la bandeja y el atajo existentes.
