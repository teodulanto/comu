# Fase 1: aplicación de escritorio

> Documento historico. Comu ya usa `whisper.cpp`, tiene instalador, atajo configurable y bandeja del sistema.

## Objetivo

Convertir la prueba web en una aplicación que pueda escuchar un atajo global y devolver el texto a la aplicación activa de Windows.

## Implementado

- Tauri 2 como ventana de escritorio.
- Rust como núcleo nativo.
- Plugin de atajo global.
- Atajo inicial: Ctrl + Alt + Espacio.
- Evento Pressed para comenzar a grabar.
- Evento Released para detener y transcribir.
- Comando insert_text llamado desde la interfaz.
- Inserción Unicode con SendInput.
- Icono base para el empaquetado.

## Flujo esperado

~~~text
Notepad tiene el cursor
  -> mantener Ctrl + Alt + Espacio
  -> hablar
  -> soltar el atajo
  -> transcribir localmente
  -> insertar texto en Notepad
~~~

## Criterio de aceptación

En Windows, abrir Notepad, colocar el cursor en el área de texto y completar el flujo sin usar botones de la aplicación.

## Pendiente

- Validación manual con Notepad, Word y un navegador.
- Mensaje visible cuando el atajo está ocupado.
- Selector de atajo configurable.
- Migración de Transformers.js a whisper.cpp nativo.
- Instalador MSI o EXE.
