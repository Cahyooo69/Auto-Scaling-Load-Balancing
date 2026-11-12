import os
import subprocess
import shutil

workspace = os.path.abspath(os.path.dirname(__file__))
html_path = os.path.join(workspace, 'laporan_progres_gabungan_pertemuan_1_2_3.html')
pdf_target = os.path.join(workspace, 'Laporan_Progres_Gabungan_Pertemuan_1_2_dan_3_Kelompok_1_Terbaru.pdf')
pdf_formal = os.path.join(workspace, 'Laporan_Progres_Gabungan_Pertemuan_1_2_dan_3_Kelompok_1_Formal.pdf')
pdf_regular = os.path.join(workspace, 'Laporan_Progres_Gabungan_Pertemuan_1_2_dan_3_Kelompok_1.pdf')

edge_exe = r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'

cmd = [
    edge_exe,
    '--headless',
    '--disable-gpu',
    '--run-all-compositor-stages-before-draw',
    '--no-pdf-header-footer',
    f'--print-to-pdf={pdf_target}',
    f'file:///{html_path.replace(os.sep, "/")}'
]

print("Executing Edge headless...")
res = subprocess.run(cmd, capture_output=True, text=True)
print("Exit code:", res.returncode)

if os.path.exists(pdf_target):
    size = os.path.getsize(pdf_target)
    print(f"Generated {pdf_target}, size: {size} bytes")
    
    # Try updating the existing names if not locked
    for dest in [pdf_formal, pdf_regular]:
        try:
            shutil.copyfile(pdf_target, dest)
            print(f"Successfully updated: {dest}")
        except Exception as e:
            print(f"Notice: Could not overwrite {dest} ({e}) - file is likely open in PDF viewer.")
else:
    print("Error: Target PDF was not generated!")
