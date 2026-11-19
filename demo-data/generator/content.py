"""Text content for the demo kamus and job-profile PDFs (fictional, Indonesian).

The kamus entries are keyed like dataset.COMPETENCIES. Each level is a list of
bullet points; the kamus page renders them with a leading bullet, which is the
same separator the web app's kamus view splits on.
"""

from __future__ import annotations

# key -> (description, basic, intermediate, advance, mastery)
KAMUS: dict[str, tuple[str, list[str], list[str], list[str], list[str]]] = {
    "RETAIL": (
        "Kemampuan menyusun target, strategi, dan rencana aksi penjualan ritel sepeda motor per area "
        "berdasarkan data pasar, kapasitas jaringan, dan program penjualan yang berlaku.",
        ["Memahami struktur target penjualan per tipe unit.", "Mencatat realisasi penjualan harian dengan benar."],
        ["Menyusun rencana penjualan bulanan per outlet.", "Memantau gap target dan mengusulkan tindakan perbaikan."],
        ["Menyusun strategi penjualan area berbasis data pangsa pasar.", "Mengalokasikan target dan unit antar area secara optimal."],
        ["Merumuskan arah strategi penjualan ritel jangka panjang.", "Menjadi rujukan perencanaan penjualan bagi seluruh area."],
    ),
    "DEALER": (
        "Kemampuan membangun dan memelihara hubungan kerja dengan jaringan dealer agar standar penjualan, "
        "pelayanan, dan program perusahaan dijalankan secara konsisten.",
        ["Mengenal profil dan kebutuhan dealer di wilayahnya.", "Menyampaikan informasi program kepada dealer dengan jelas."],
        ["Menindaklanjuti keluhan dealer sampai tuntas.", "Melakukan kunjungan rutin dan mencatat temuan lapangan."],
        ["Menyusun rencana pengembangan dealer berdasarkan evaluasi kinerja.", "Menegosiasikan kesepakatan target dan program dengan dealer."],
        ["Merancang model kemitraan dealer jangka panjang.", "Menyelesaikan konflik strategis dengan pemilik jaringan dealer."],
    ),
    "MARCOM": (
        "Kemampuan merencanakan, melaksanakan, dan mengevaluasi kampanye pemasaran terpadu melintasi kanal "
        "media, digital, dan event untuk mendukung penjualan.",
        ["Memahami kalender promosi dan materi kampanye.", "Menyiapkan materi promosi sesuai panduan merek."],
        ["Menjalankan kampanye di satu kanal sesuai rencana.", "Mengukur hasil kampanye dengan indikator yang disepakati."],
        ["Merancang kampanye lintas kanal dengan anggaran yang terkendali.", "Mengoptimalkan bauran media berdasarkan hasil pengukuran."],
        ["Menetapkan strategi komunikasi pemasaran tahunan.", "Membangun kerangka evaluasi efektivitas pemasaran perusahaan."],
    ),
    "FINREP": (
        "Kemampuan menjalankan proses tutup buku dan menyusun laporan keuangan yang akurat, tepat waktu, dan "
        "sesuai standar akuntansi yang berlaku.",
        ["Mencatat jurnal transaksi rutin dengan benar.", "Menyiapkan dokumen pendukung tutup buku."],
        ["Melakukan rekonsiliasi akun dan menelusuri selisih.", "Menyusun laporan keuangan bulanan per unit."],
        ["Mengendalikan jadwal dan kualitas tutup buku perusahaan.", "Menganalisis laporan keuangan dan menjelaskan variansnya."],
        ["Menetapkan kebijakan akuntansi dan pelaporan.", "Mewakili perusahaan dalam audit eksternal laporan keuangan."],
    ),
    "TAX": (
        "Kemampuan memastikan kewajiban perpajakan perusahaan dihitung, dibayar, dan dilaporkan dengan benar "
        "serta meminimalkan risiko sanksi pajak.",
        ["Memahami jenis pajak yang berlaku bagi perusahaan.", "Menyiapkan bukti potong dan dokumen pajak rutin."],
        ["Menghitung dan melaporkan pajak bulanan.", "Merekonsiliasi data pajak dengan pembukuan."],
        ["Menyusun perencanaan pajak tahunan.", "Mendampingi pemeriksaan pajak dan menyiapkan tanggapan."],
        ["Merumuskan strategi perpajakan perusahaan.", "Menangani sengketa dan keberatan pajak yang kompleks."],
    ),
    "TREASURY": (
        "Kemampuan mengelola arus kas, likuiditas, dan hubungan perbankan agar kebutuhan dana operasional "
        "terpenuhi dengan biaya yang efisien.",
        ["Mencatat penerimaan dan pengeluaran kas harian.", "Menyiapkan dokumen pembayaran sesuai prosedur."],
        ["Menyusun proyeksi arus kas mingguan.", "Mengelola penempatan dana jangka pendek sesuai kebijakan."],
        ["Mengoptimalkan struktur pendanaan dan fasilitas bank.", "Mengendalikan risiko likuiditas perusahaan."],
        ["Menetapkan kebijakan treasury dan manajemen risiko keuangan.", "Bernegosiasi dengan perbankan untuk pendanaan strategis."],
    ),
    "LEARNING": (
        "Kemampuan merancang, menyelenggarakan, dan mengevaluasi program pembelajaran yang menjawab kebutuhan "
        "kompetensi organisasi.",
        ["Menyiapkan logistik dan administrasi pelatihan.", "Mengumpulkan evaluasi reaksi peserta."],
        ["Menyusun silabus dan materi pelatihan.", "Mengevaluasi hasil belajar peserta."],
        ["Merancang kurikulum berbasis analisis kebutuhan kompetensi.", "Mengukur dampak pelatihan terhadap kinerja."],
        ["Menetapkan arsitektur pembelajaran perusahaan.", "Membangun akademi internal dan sistem sertifikasi."],
    ),
    "TALENT": (
        "Kemampuan mengidentifikasi, memetakan, dan mengembangkan talenta serta menyiapkan suksesor untuk "
        "posisi kunci perusahaan.",
        ["Mengelola data talenta dan hasil penilaian.", "Menyiapkan bahan rapat talent review."],
        ["Memetakan talenta pada matriks kinerja-potensi.", "Menyusun rencana pengembangan individu."],
        ["Memfasilitasi talent review dan forum suksesi.", "Menyusun peta suksesi posisi kritikal."],
        ["Merancang sistem manajemen talenta perusahaan.", "Memastikan kesiapan suksesor untuk seluruh posisi kunci."],
    ),
    "APPDEV": (
        "Kemampuan menjalankan siklus pengembangan aplikasi mulai dari analisis kebutuhan, desain, pemrograman, "
        "pengujian, hingga rilis dan pemeliharaan.",
        ["Memahami tahapan siklus pengembangan aplikasi.", "Memperbaiki defect sederhana sesuai arahan."],
        ["Membangun fitur sesuai spesifikasi dan standar kode.", "Menyusun skenario uji dan dokumentasi teknis."],
        ["Merancang arsitektur aplikasi dan meninjau kode tim.", "Mengendalikan kualitas dan jadwal rilis."],
        ["Menetapkan standar dan metodologi pengembangan perusahaan.", "Memimpin transformasi portofolio aplikasi."],
    ),
    "SYSINT": (
        "Kemampuan merancang dan memelihara integrasi data dan proses antar sistem perusahaan secara andal "
        "dan aman.",
        ["Memahami alur data antar sistem utama.", "Memantau status antarmuka dan melaporkan gangguan."],
        ["Membangun antarmuka integrasi sesuai spesifikasi.", "Menelusuri dan memperbaiki kegagalan integrasi."],
        ["Merancang pola integrasi dan kontrak data antar sistem.", "Mengendalikan keamanan dan keandalan integrasi."],
        ["Menetapkan arsitektur integrasi perusahaan.", "Memimpin integrasi sistem berskala besar."],
    ),
    "SERVICE": (
        "Kemampuan menjamin mutu layanan servis sepeda motor di jaringan bengkel sesuai standar teknis dan "
        "harapan konsumen.",
        ["Memahami standar operasional servis berkala.", "Mencatat temuan mutu servis dengan benar."],
        ["Melakukan audit mutu servis di bengkel.", "Menganalisis keluhan konsumen dan akar masalahnya."],
        ["Merancang program peningkatan mutu servis.", "Mengendalikan kinerja mutu seluruh jaringan bengkel."],
        ["Menetapkan standar mutu servis perusahaan.", "Menjadi rujukan teknis untuk kasus servis yang kompleks."],
    ),
    "SPAREPART": (
        "Kemampuan memperkirakan kebutuhan dan mengelola persediaan suku cadang agar ketersediaan terjaga "
        "dengan biaya persediaan yang efisien.",
        ["Mencatat penerimaan dan pengeluaran suku cadang.", "Melakukan stock opname sesuai prosedur."],
        ["Menyusun usulan pemesanan berdasarkan pola permintaan.", "Memantau tingkat ketersediaan dan stok mati."],
        ["Membangun model peramalan kebutuhan suku cadang.", "Mengoptimalkan tingkat persediaan antar gudang."],
        ["Menetapkan strategi rantai pasok suku cadang.", "Memimpin perbaikan sistem perencanaan persediaan."],
    ),
    "BUDGET": (
        "Kemampuan menyusun, memantau, dan mengendalikan anggaran operasional unit kerja agar sejalan dengan "
        "target dan prioritas perusahaan.",
        ["Memahami pos-pos anggaran unit kerja.", "Mencatat realisasi biaya sesuai pos anggaran."],
        ["Menyusun usulan anggaran unit kerja.", "Memantau realisasi dan menjelaskan penyimpangan."],
        ["Mengendalikan anggaran beberapa unit kerja.", "Mengusulkan realokasi anggaran berbasis prioritas."],
        ["Menetapkan kerangka penganggaran perusahaan.", "Mengarahkan alokasi anggaran strategis lintas divisi."],
    ),
    "DATA": (
        "Kemampuan mengolah, menganalisis, dan menyajikan data bisnis menjadi informasi yang mendukung "
        "pengambilan keputusan.",
        ["Mengumpulkan dan merapikan data sesuai format.", "Menyajikan data dalam tabel sederhana."],
        ["Mengolah data dengan rumus dan tabel pivot.", "Menyusun laporan berkala dengan visualisasi."],
        ["Menganalisis tren dan memberikan rekomendasi.", "Membangun dashboard untuk pemantauan kinerja."],
        ["Menetapkan standar data dan pelaporan.", "Mengembangkan model analitik untuk keputusan strategis."],
    ),
}


# Per job-profile seat: purpose, responsibilities, authorities, relations,
# problem solving, specification. Technical competencies come from the seat's
# own competency list in dataset.POSITIONS, so the PDF and the Excel agree.
BEHAVIORAL = {
    "head": ["Passion for Excellence", "Leadership", "Strategic Thinking", "Customer Focus", "Developing Others", "Integrity"],
    "supervisor": ["Passion for Excellence", "Leadership", "Problem Solving", "Teamwork", "Customer Focus", "Integrity"],
}

JOB_PROFILES: dict[str, dict] = {
    "DM04060001": {
        "purpose": "Memastikan aplikasi bisnis perusahaan dikembangkan dan dipelihara secara andal, aman, dan tepat "
                   "waktu untuk mendukung proses penjualan, keuangan, dan layanan purna jual.",
        "responsibilities": [
            ("Menyusun roadmap pengembangan aplikasi tahunan bersama unit bisnis.", "Roadmap disetujui paling lambat Desember"),
            ("Mengendalikan proyek pengembangan dari analisis hingga rilis.", "90% proyek rilis sesuai jadwal"),
            ("Menetapkan standar kode, pengujian, dan dokumentasi tim.", "Defect produksi < 5 per rilis"),
            ("Mengelola anggaran dan vendor pengembangan aplikasi.", "Realisasi anggaran 95-100%"),
            ("Mengembangkan kompetensi dan karier anggota tim.", "Setiap anggota tim memiliki IDP aktif"),
        ],
        "authorities": ["Menyetujui desain teknis dan rilis aplikasi.", "Menyetujui pengeluaran anggaran pengembangan sesuai limit.",
                        "Menilai kinerja anggota tim."],
        "internal": ["Seluruh divisi pengguna aplikasi", "IT Infrastructure", "Internal Audit"],
        "external": ["Vendor perangkat lunak", "Konsultan TI"],
        "challenges": ["Menyeimbangkan permintaan perubahan dengan kapasitas tim.", "Menjaga keamanan data di tengah integrasi baru."],
        "education": "S1 Teknik Informatika / Sistem Informasi",
        "experience": "Minimal 8 tahun di pengembangan aplikasi, 3 tahun di antaranya memimpin tim",
        "skills": ["Manajemen proyek TI", "Arsitektur aplikasi", "Sertifikasi Scrum (diutamakan)"],
        "level": "head",
    },
    "DM02040001": {
        "purpose": "Menjamin likuiditas perusahaan terjaga dan seluruh kewajiban perpajakan dipenuhi tepat waktu "
                   "dengan risiko sanksi yang minimal.",
        "responsibilities": [
            ("Menyusun proyeksi arus kas dan rencana pendanaan.", "Akurasi proyeksi kas bulanan >= 90%"),
            ("Mengelola hubungan dan fasilitas perbankan.", "Biaya dana di bawah anggaran"),
            ("Memastikan pelaporan dan pembayaran pajak tepat waktu.", "Nol denda keterlambatan pajak"),
            ("Mendampingi pemeriksaan pajak dan menyiapkan tanggapan.", "Koreksi fiskal < 1% dari laba"),
            ("Mengembangkan tim treasury dan pajak.", "Setiap anggota tim memiliki IDP aktif"),
        ],
        "authorities": ["Menyetujui penempatan dana jangka pendek sesuai limit.", "Menandatangani SPT masa atas nama perusahaan.",
                        "Menilai kinerja anggota tim."],
        "internal": ["Accounting", "Seluruh divisi (anggaran dan pembayaran)"],
        "external": ["Perbankan", "Kantor Pelayanan Pajak", "Konsultan pajak"],
        "challenges": ["Perubahan regulasi pajak yang cepat.", "Fluktuasi kebutuhan dana musiman."],
        "education": "S1 Akuntansi / Manajemen Keuangan",
        "experience": "Minimal 7 tahun di bidang treasury atau perpajakan, 3 tahun di level supervisor",
        "skills": ["Brevet Pajak A dan B", "Analisis arus kas", "Negosiasi perbankan"],
        "level": "head",
    },
    "DM01010001": {
        "purpose": "Memastikan target penjualan ritel tercapai melalui perencanaan area, pengelolaan tenaga penjual, "
                   "dan kemitraan dealer yang efektif.",
        "responsibilities": [
            ("Menyusun dan mengalokasikan target penjualan per area.", "Pencapaian target penjualan >= 100%"),
            ("Memantau kinerja area dan outlet secara mingguan.", "Gap target ditindaklanjuti dalam 1 minggu"),
            ("Mengembangkan kemitraan dan standar layanan dealer.", "Skor kepuasan dealer >= 85"),
            ("Mengendalikan anggaran program penjualan.", "Realisasi anggaran 95-100%"),
            ("Mengembangkan supervisor dan tenaga penjual.", "Setiap supervisor memiliki IDP aktif"),
        ],
        "authorities": ["Menetapkan alokasi target antar area.", "Menyetujui program penjualan lokal sesuai limit.",
                        "Menilai kinerja supervisor."],
        "internal": ["Marketing Communication", "Sales Operation", "Finance & Accounting"],
        "external": ["Jaringan dealer", "Perusahaan pembiayaan"],
        "challenges": ["Persaingan harga antar merek.", "Ketersediaan unit pada musim permintaan tinggi."],
        "education": "S1 Semua Jurusan",
        "experience": "Minimal 8 tahun di penjualan ritel, 3 tahun memimpin area",
        "skills": ["Perencanaan penjualan", "Negosiasi", "Analisis data penjualan"],
        "level": "head",
    },
    "DM03050001": {
        "purpose": "Memastikan organisasi memiliki talenta yang kompeten dan suksesor yang siap melalui program "
                   "pembelajaran dan manajemen talenta yang terukur.",
        "responsibilities": [
            ("Menyusun rencana pembelajaran tahunan berbasis kebutuhan kompetensi.", "Rencana disetujui paling lambat Desember"),
            ("Menyelenggarakan talent review dan forum suksesi.", "Forum suksesi berjalan 2 kali setahun"),
            ("Mengukur efektivitas program pembelajaran.", "Skor dampak pelatihan >= 75%"),
            ("Mengelola anggaran pengembangan SDM.", "Realisasi anggaran 95-100%"),
            ("Mengembangkan tim People Development.", "Setiap anggota tim memiliki IDP aktif"),
        ],
        "authorities": ["Menyetujui kurikulum dan vendor pelatihan sesuai limit.", "Menetapkan jadwal talent review.",
                        "Menilai kinerja anggota tim."],
        "internal": ["Seluruh division head", "HR Operations"],
        "external": ["Lembaga pelatihan", "Konsultan assessment"],
        "challenges": ["Mengukur dampak pembelajaran terhadap kinerja.", "Menyiapkan suksesor untuk posisi yang langka."],
        "education": "S1 Psikologi / Manajemen SDM",
        "experience": "Minimal 7 tahun di pengembangan SDM, 3 tahun di level supervisor",
        "skills": ["Desain instruksional", "Asesmen kompetensi", "Fasilitasi"],
        "level": "head",
    },
    "DM05080001": {
        "purpose": "Menjamin ketersediaan suku cadang bagi jaringan bengkel dengan tingkat persediaan dan biaya "
                   "yang efisien.",
        "responsibilities": [
            ("Menyusun perencanaan kebutuhan suku cadang bulanan.", "Service level ketersediaan >= 95%"),
            ("Mengendalikan tingkat persediaan dan stok mati.", "Stok mati < 3% nilai persediaan"),
            ("Mengelola operasional gudang dan distribusi.", "Akurasi stock opname >= 99%"),
            ("Mengendalikan anggaran departemen.", "Realisasi anggaran 95-100%"),
            ("Mengembangkan supervisor dan staf gudang.", "Setiap supervisor memiliki IDP aktif"),
        ],
        "authorities": ["Menyetujui pesanan pembelian suku cadang sesuai limit.", "Menetapkan kebijakan stok pengaman.",
                        "Menilai kinerja anggota tim."],
        "internal": ["Technical Service", "Finance & Accounting", "Retail Sales"],
        "external": ["Pemasok suku cadang", "Perusahaan ekspedisi"],
        "challenges": ["Permintaan suku cadang yang fluktuatif.", "Keterbatasan kapasitas gudang."],
        "education": "S1 Teknik Industri / Manajemen",
        "experience": "Minimal 7 tahun di logistik atau perencanaan persediaan, 3 tahun memimpin tim",
        "skills": ["Peramalan permintaan", "Manajemen gudang", "Analisis data"],
        "level": "head",
    },
    "DM04060011": {
        "purpose": "Memastikan tim pengembang menghasilkan fitur aplikasi yang berkualitas dan terintegrasi dengan "
                   "baik sesuai prioritas departemen.",
        "responsibilities": [
            ("Membagi dan memantau pekerjaan pengembangan tim.", "90% tugas selesai sesuai sprint"),
            ("Meninjau kode dan hasil pengujian sebelum rilis.", "Defect produksi < 5 per rilis"),
            ("Merancang integrasi antar sistem bersama System Integrator.", "Kegagalan integrasi < 1% transaksi"),
            ("Menyusun laporan kemajuan proyek.", "Laporan mingguan tepat waktu"),
            ("Membimbing analis dalam praktik pengembangan.", "Setiap analis memiliki IDP aktif"),
        ],
        "authorities": ["Menyetujui hasil tinjauan kode.", "Menetapkan prioritas tugas dalam sprint."],
        "internal": ["Pengguna aplikasi", "IT Infrastructure"],
        "external": ["Vendor perangkat lunak"],
        "challenges": ["Menjaga kualitas di bawah tenggat yang ketat.", "Mengelola utang teknis aplikasi lama."],
        "education": "S1 Teknik Informatika / Sistem Informasi",
        "experience": "Minimal 5 tahun di pengembangan aplikasi",
        "skills": ["Pemrograman web dan basis data", "Code review", "Agile"],
        "level": "supervisor",
    },
}
