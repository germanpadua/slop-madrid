#!/usr/bin/env python3
"""QC visual solicitado: DeepSeek vía nan.builders, nunca persiste ni imprime la clave.

Ejecutar tras monumentos_render.py. Conserva respuestas, hash del PNG y rondas
(máximo tres por pieza) en /tmp/monumentos-codex/qc.md y *-qc-rN.json.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import urllib.request
from concurrent.futures import ThreadPoolExecutor

CRITERIA = {
    'cibeles': 'Fuente de Cibeles: peñasco irregular, carro de ruedas circulares, diosa sentada coronada y DOS leones con cuerpos, patas y cabezas delante. El bacín es una malla municipal que se conserva.',
    'neptuno': 'Fuente de Neptuno: bacín oval de dos molduras, pedestal con volutas, dios humano de pie con brazo extendido que sujeta un tridente de TRES púas visibles; delfines o rocas laterales.',
    'debod': 'Templo de Debod: templo de piedra, cubierta con pico bajo a dos aguas según brief del proyecto, columnas cónicas con vigas, segundo pórtico, dos puertas exentas axiales, muro en L y estanque oscuro hundido. El pico es una interpretación solicitada, no una reconstrucción arqueológica.',
    'plazaespana': 'Monumento a Cervantes en Plaza de España: base y escalinata, estela alta de varios cuerpos y remate con globo, DOS brazos laterales curvos con grupos de personas de cuerpos y cabezas; Cervantes sentado y Quijote y Sancho de pie al frente (esta pose de pie es exigencia del brief, aunque el original tenga monturas).',
}


def judge(mid, folder, round_number):
    output = folder / f'{mid}-qc-r{round_number}.json'
    if output.exists():
        raise ValueError(f'La ronda {round_number} de {mid} ya existe; no se sobrescribe')
    if round_number not in (1, 2, 3):
        raise ValueError('Máximo tres rondas por pieza')
    raw = (folder / f'{mid}-r{round_number}.png').read_bytes()
    prompt = f'''Actúa como revisor visual crítico de geometría procedural para un visor isométrico.
Evalúa sólo la imagen adjunta (conjunto y detalle o reverso), sin asumir que existe lo que no se ve.
Objetivo: {CRITERIA[mid]}
¿Es reconocible como ese monumento al verlo de cerca? ¿Se ven los rasgos pedidos?
No exijas fotorrealismo ni detalles menores incompatibles con posiciones cuantizadas a 10 cm.
Responde en español: VEREDICTO: POSITIVO o NEGATIVO; luego qué ves, qué falta, y hasta tres correcciones concretas si son necesarias. Distingue problemas de geometría de oclusiones de esta vista.'''
    body = {
        'model': 'deepseek-v4-flash', 'max_tokens': 1500, 'temperature': 0,
        'thinking': {'type': 'disabled'},
        'messages': [{'role': 'user', 'content': [
            {'type': 'text', 'text': prompt},
            {'type': 'image_url', 'image_url': {'url': 'data:image/png;base64,' + base64.b64encode(raw).decode()}}
        ]}]
    }
    # La clave vive sólo en memoria y en la cabecera de la petición TLS.
    key = (Path.home() / '.nan_api_key').read_text().strip()
    request = urllib.request.Request('https://api.nan.builders/v1/chat/completions',
        data=json.dumps(body).encode(), headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=180) as response:
        data = json.load(response)
    content = data['choices'][0]['message'].get('content')
    if not content:
        raise ValueError(f'{mid}: respuesta sin veredicto; no se registra como QC completado')
    record = {'id': mid, 'round': round_number, 'model': data.get('model'),
              'max_tokens': 1500, 'temperature': 0, 'thinking': 'disabled',
              'image': f'{mid}-r{round_number}.png', 'image_sha256': hashlib.sha256(raw).hexdigest(),
              'verdict': content, 'usage': data.get('usage')}
    output.write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n')
    print(mid, f'ronda {round_number}:', content, flush=True)


def report(folder):
    lines = ['# QC visual de monumentos', '',
             'Modelo solicitado: `deepseek-v4-flash`; temperature 0; max_tokens 1500.',
             'Renders del JSON de los módulos, azimut 45° / elevación 30°, con z-buffer y caras traseras descartadas.',
             'Cada hoja muestra conjunto y detalle (Debod: conjunto y reverso). Máximo tres rondas por pieza.',
             'Se desactiva thinking para que el límite de 1500 tokens se dedique a la respuesta visible.', '']
    for mid in CRITERIA:
        lines.extend([f'## {mid}', ''])
        for path in sorted(folder.glob(f'{mid}-qc-r*.json')):
            data = json.loads(path.read_text())
            lines.extend([f"### Ronda {data['round']}", '', f"Imagen: [{data['image']}]({data['image']})",
                          f"SHA256: `{data['image_sha256']}`", '', data['verdict'], ''])
    (folder / 'qc.md').write_text('\n'.join(lines))


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('ids', nargs='+', choices=CRITERIA)
    ap.add_argument('--round', type=int, required=True, choices=(1, 2, 3))
    ap.add_argument('--out', type=Path, default=Path('/tmp/monumentos-codex'))
    args = ap.parse_args()
    try:
        with ThreadPoolExecutor(max_workers=4) as executor:
            list(executor.map(lambda mid: judge(mid, args.out, args.round), args.ids))
    finally:
        report(args.out)


if __name__ == '__main__':
    main()
