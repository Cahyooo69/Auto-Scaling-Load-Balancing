Add-Type -AssemblyName System.Drawing

function Draw-ArchitectureDiagram {
    param($outputPath)
    $w = 1200
    $h = 700
    $bmp = New-Object System.Drawing.Bitmap($w, $h)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

    # Background
    $bgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(248, 250, 252))
    $g.FillRectangle($bgBrush, 0, 0, $w, $h)

    # Title Banner
    $titleBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(15, 23, 42))
    $titleFont = New-Object System.Drawing.Font("Segoe UI", 18, [System.Drawing.FontStyle]::Bold)
    $subFont = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Regular)
    $g.DrawString("ARSITEKTUR HIGH-AVAILABILITY CLOUD COMPUTING", $titleFont, $titleBrush, 40, 25)
    $subBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(100, 116, 139))
    $g.DrawString("Sistem War Tiket Konser Musik Berbasis Docker Swarm, Nginx HA, dan Redis In-Memory Store", $subFont, $subBrush, 40, 60)

    # Outer Boundary: Docker Swarm Cluster
    $clusterPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(148, 163, 184), 2)
    $clusterPen.DashStyle = [System.Drawing.Drawing2D.DashStyle]::Dash
    $clusterBg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 255, 255))
    $g.FillRectangle($clusterBg, 30, 95, 1140, 570)
    $g.DrawRectangle($clusterPen, 30, 95, 1140, 570)

    $labelFont = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)
    $labelBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(71, 85, 105))
    $g.DrawString("DOCKER SWARM OVERLAY NETWORK: wartiket-net (Subnet Terisolasi)", $labelFont, $labelBrush, 50, 108)

    # Tier 1: Clients (Left)
    $clientBg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(238, 242, 255))
    $clientPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(99, 102, 241), 2)
    $g.FillRectangle($clientBg, 55, 170, 160, 450)
    $g.DrawRectangle($clientPen, 55, 170, 160, 450)
    $tierHeaderFont = New-Object System.Drawing.Font("Segoe UI", 11, [System.Drawing.FontStyle]::Bold)
    $tierHeaderBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(49, 46, 129))
    $g.DrawString("CLIENT TIER", $tierHeaderFont, $tierHeaderBrush, 85, 185)

    $boxBg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $boxPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(199, 210, 254), 1.5)
    $itemFont = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
    $itemSub = New-Object System.Drawing.Font("Segoe UI", 8, [System.Drawing.FontStyle]::Regular)
    $darkText = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(30, 41, 59))
    $mutedText = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(100, 116, 139))

    # Client items
    $g.FillRectangle($boxBg, 70, 230, 130, 80)
    $g.DrawRectangle($boxPen, 70, 230, 130, 80)
    $g.DrawString("Web Browser", $itemFont, $darkText, 85, 245)
    $g.DrawString("Pengguna War Tiket", $itemSub, $mutedText, 80, 270)

    $g.FillRectangle($boxBg, 70, 340, 130, 80)
    $g.DrawRectangle($boxPen, 70, 340, 130, 80)
    $g.DrawString("Load Tester (K6)", $itemFont, $darkText, 78, 355)
    $g.DrawString("1.000 Virtual Users", $itemSub, $mutedText, 80, 380)

    $g.FillRectangle($boxBg, 70, 450, 130, 80)
    $g.DrawRectangle($boxPen, 70, 450, 130, 80)
    $g.DrawString("Autocannon CLI", $itemFont, $darkText, 78, 465)
    $g.DrawString("Stress Load Test", $itemSub, $mutedText, 83, 490)

    # Arrow 1: Client -> Ingress
    $arrowPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(37, 99, 235), 2.5)
    $arrowPen.CustomEndCap = New-Object System.Drawing.Drawing2D.AdjustableArrowCap(6, 6)
    $g.DrawLine($arrowPen, 215, 390, 280, 390)
    $protoFont = New-Object System.Drawing.Font("Segoe UI", 8, [System.Drawing.FontStyle]::Bold)
    $protoBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(37, 99, 235))
    $g.DrawString("HTTP Port 80/443", $protoFont, $protoBrush, 210, 368)

    # Tier 2: Ingress Layer (Nginx HA)
    $ingressBg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(240, 253, 244))
    $ingressPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(34, 197, 94), 2)
    $g.FillRectangle($ingressBg, 280, 170, 220, 450)
    $g.DrawRectangle($ingressPen, 280, 170, 220, 450)
    $ingHeaderBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(20, 83, 45))
    $g.DrawString("INGRESS TIER (HA)", $tierHeaderFont, $ingHeaderBrush, 320, 185)

    # Ingress Mesh Box
    $meshBg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(220, 252, 231))
    $meshPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(74, 222, 128), 1.5)
    $g.FillRectangle($meshBg, 295, 225, 190, 50)
    $g.DrawRectangle($meshPen, 295, 225, 190, 50)
    $g.DrawString("Swarm Ingress Mesh (IPVS)", $itemFont, $ingHeaderBrush, 305, 235)
    $g.DrawString("VIP Routing & Port 80 Binding", $itemSub, $mutedText, 310, 252)

    # Nginx 1 & Nginx 2
    $g.FillRectangle($boxBg, 295, 295, 190, 130)
    $g.DrawRectangle($boxPen, 295, 295, 190, 130)
    $g.DrawString("wartiket_nginx.1", $itemFont, $darkText, 335, 305)
    $badgeLimitBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(234, 88, 12))
    $g.DrawString("Limit: 0.25 CPU / 256M", $itemSub, $badgeLimitBrush, 325, 325)
    $g.DrawString("• Reverse Proxy & SSL", $itemSub, $mutedText, 310, 350)
    $g.DrawString("• Upstream Load Balancer", $itemSub, $mutedText, 310, 370)
    $g.DrawString("• Single-Worker Optimized", $itemSub, $mutedText, 310, 390)

    $g.FillRectangle($boxBg, 295, 445, 190, 130)
    $g.DrawRectangle($boxPen, 295, 445, 190, 130)
    $g.DrawString("wartiket_nginx.2 (Standby/HA)", $itemFont, $darkText, 305, 455)
    $g.DrawString("Limit: 0.25 CPU / 256M", $itemSub, $badgeLimitBrush, 325, 475)
    $g.DrawString("• Active-Active Redundancy", $itemSub, $mutedText, 310, 500)
    $g.DrawString("• 0ms Downtime Failover", $itemSub, $mutedText, 310, 520)
    $g.DrawString("• Healthcheck Auto-Heal", $itemSub, $mutedText, 310, 540)

    # Arrow 2: Nginx -> App Cluster
    $g.DrawLine($arrowPen, 500, 390, 560, 390)
    $g.DrawString("Internal Port 3000", $protoFont, $protoBrush, 495, 368)

    # Tier 3: Application Tier (Auto-Scaling Node.js)
    $appBg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(254, 243, 199))
    $appPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(245, 158, 11), 2)
    $g.FillRectangle($appBg, 560, 170, 290, 450)
    $g.DrawRectangle($appPen, 560, 170, 290, 450)
    $appHeaderBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(146, 64, 14))
    $g.DrawString("APPLICATION TIER (AUTO-SCALING)", $tierHeaderFont, $appHeaderBrush, 580, 185)

    # App containers (2 baseline -> 8 scaling)
    $g.FillRectangle($boxBg, 575, 230, 260, 85)
    $g.DrawRectangle($boxPen, 575, 230, 260, 85)
    $g.DrawString("wartiket_app.1 (Node.js Alpine)", $itemFont, $darkText, 590, 240)
    $g.DrawString("Limit: 0.25 CPU / 256M RAM | Port: 3000 (Internal)", $itemSub, $badgeLimitBrush, 590, 260)
    $g.DrawString("Endpoint: /buy, /tickets, /health, /metrics", $itemSub, $mutedText, 590, 280)

    $g.FillRectangle($boxBg, 575, 330, 260, 85)
    $g.DrawRectangle($boxPen, 575, 330, 260, 85)
    $g.DrawString("wartiket_app.2 (Node.js Alpine)", $itemFont, $darkText, 590, 340)
    $g.DrawString("Limit: 0.25 CPU / 256M RAM | Port: 3000 (Internal)", $itemSub, $badgeLimitBrush, 590, 360)
    $g.DrawString("Load distribution: 50% load balanced via VIP", $itemSub, $mutedText, 590, 380)

    $scaleBoxBg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 251, 235))
    $scalePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(217, 119, 6), 1.5)
    $scalePen.DashStyle = [System.Drawing.Drawing2D.DashStyle]::Dash
    $g.FillRectangle($scaleBoxBg, 575, 430, 260, 160)
    $g.DrawRectangle($scalePen, 575, 430, 260, 160)
    $g.DrawString("Auto-Scaling Cluster (wartiket_app.3 ... 8)", $itemFont, $appHeaderBrush, 585, 442)
    $g.DrawString("Skalasi elastis saat lonjakan flash crowd:", $itemSub, $darkText, 590, 465)
    $g.DrawString("• 'docker service scale wartiket_app=8'", $itemSub, $mutedText, 590, 485)
    $g.DrawString("• Waktu konvergensi klaster: 2.8 detik", $itemSub, $mutedText, 590, 505)
    $g.DrawString("• Graceful degradation & circuit breaker", $itemSub, $mutedText, 590, 525)
    $g.DrawString("• Auto-drain & auto-rollback support", $itemSub, $mutedText, 590, 545)

    # Arrow 3: App -> Redis
    $g.DrawLine($arrowPen, 850, 390, 910, 390)
    $g.DrawString("RESP Port 6379", $protoFont, $protoBrush, 845, 368)

    # Tier 4: Data & Caching Tier (Redis)
    $dataBg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(254, 242, 242))
    $dataPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(239, 68, 68), 2)
    $g.FillRectangle($dataBg, 910, 170, 235, 450)
    $g.DrawRectangle($dataPen, 910, 170, 235, 450)
    $dataHeaderBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(153, 27, 27))
    $g.DrawString("DATA & CACHE TIER", $tierHeaderFont, $dataHeaderBrush, 940, 185)

    $g.FillRectangle($boxBg, 925, 230, 205, 170)
    $g.DrawRectangle($boxPen, 925, 230, 205, 170)
    $g.DrawString("wartiket_redis (Redis 7)", $itemFont, $darkText, 940, 245)
    $g.DrawString("Limit: 0.25 CPU / 256M RAM", $itemSub, $badgeLimitBrush, 940, 268)
    $g.DrawString("Port 6379 (Isolasi Internal)", $itemSub, $dataHeaderBrush, 940, 288)
    $g.DrawString("• Atomic DECR Quota Engine", $itemSub, $mutedText, 940, 312)
    $g.DrawString("• Anti Race-Condition", $itemSub, $mutedText, 940, 332)
    $g.DrawString("• Maxmemory: 128MB LRU", $itemSub, $mutedText, 940, 352)
    $g.DrawString("• Single-Worker Architecture", $itemSub, $mutedText, 940, 372)

    # Persistent Volume
    $volBg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(241, 245, 249))
    $volPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(100, 116, 139), 1.5)
    $g.FillRectangle($volBg, 925, 430, 205, 130)
    $g.DrawRectangle($volPen, 925, 430, 205, 130)
    $g.DrawString("Docker Persistent Volume", $itemFont, $darkText, 945, 445)
    $g.DrawString("Volume Name: redis-data", $itemSub, $mutedText, 940, 470)
    $g.DrawString("Path: /data (Mount Host)", $itemSub, $mutedText, 940, 490)
    $g.DrawString("Mode: appendonly yes (AOF)", $itemSub, $darkText, 940, 510)
    $g.DrawString("Data kuota tiket aman 100%", $itemSub, $mutedText, 940, 530)

    $bmp.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
    Write-Output "Architecture Diagram successfully generated: $outputPath"
}

function Draw-NetworkTopologyDiagram {
    param($outputPath)
    $w = 1200
    $h = 600
    $bmp = New-Object System.Drawing.Bitmap($w, $h)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

    # Background
    $bgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(248, 250, 252))
    $g.FillRectangle($bgBrush, 0, 0, $w, $h)

    # Title Banner
    $titleBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(15, 23, 42))
    $titleFont = New-Object System.Drawing.Font("Segoe UI", 18, [System.Drawing.FontStyle]::Bold)
    $subFont = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Regular)
    $g.DrawString("SKEMA TOPOLOGI JARINGAN DOCKER SWARM & ISOLASI PORT", $titleFont, $titleBrush, 40, 25)
    $subBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(100, 116, 139))
    $g.DrawString("Segmentasi Zona Akses Publik vs Private Overlay Network wartiket-net", $subFont, $subBrush, 40, 60)

    # Left: Public Internet Zone
    $pubBg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(254, 242, 242))
    $pubPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(239, 68, 68), 2)
    $pubPen.DashStyle = [System.Drawing.Drawing2D.DashStyle]::Dash
    $g.FillRectangle($pubBg, 40, 100, 260, 460)
    $g.DrawRectangle($pubPen, 40, 100, 260, 460)

    $zoneHeaderFont = New-Object System.Drawing.Font("Segoe UI", 12, [System.Drawing.FontStyle]::Bold)
    $zoneHeaderBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(185, 28, 28))
    $g.DrawString("ZONA PUBLIK (UNTRUSTED)", $zoneHeaderFont, $zoneHeaderBrush, 55, 115)
    $subZoneFont = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Regular)
    $darkText = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(30, 41, 59))
    $mutedText = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(100, 116, 139))
    $g.DrawString("Akses Terbuka Internet / Klien", $subZoneFont, $mutedText, 55, 140)

    $boxBg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $boxPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(203, 213, 225), 1.5)
    $itemFont = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)

    $g.FillRectangle($boxBg, 60, 200, 220, 120)
    $g.DrawRectangle($boxPen, 60, 200, 220, 120)
    $g.DrawString("Internet Traffic / Klien", $itemFont, $darkText, 80, 215)
    $g.DrawString("• URL: http://wartiketkonser.id", $subZoneFont, $mutedText, 75, 240)
    $g.DrawString("• Port Akses: 80 (HTTP) & 443", $subZoneFont, $mutedText, 75, 260)
    $g.DrawString("• Protokol: TCP / WebSockets", $subZoneFont, $mutedText, 75, 280)

    $g.FillRectangle($boxBg, 60, 360, 220, 120)
    $g.DrawRectangle($boxPen, 60, 360, 220, 120)
    $g.DrawString("Penguji Beban (Load Tester)", $itemFont, $darkText, 75, 375)
    $g.DrawString("• K6 / Autocannon Benchmarker", $subZoneFont, $mutedText, 75, 400)
    $g.DrawString("• Target: Port 80 Entry Point", $subZoneFont, $mutedText, 75, 420)
    $g.DrawString("• 1.000 Virtual Users Concurrency", $subZoneFont, $mutedText, 75, 440)

    # Middle Firewall / Ingress Gateway Barrier
    $barBg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(30, 41, 59))
    $g.FillRectangle($barBg, 320, 100, 35, 460)
    $barFont = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
    $barBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $sf = New-Object System.Drawing.StringFormat
    $sf.FormatFlags = [System.Drawing.StringFormatFlags]::DirectionVertical
    $g.DrawString("FIREWALL & DOCKER INGRESS GATEWAY (INGRESS ROUTING MESH)", $barFont, $barBrush, 327, 120, $sf)

    # Right: Private Swarm Overlay Network Zone
    $privBg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(240, 249, 255))
    $privPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(2, 132, 199), 2)
    $g.FillRectangle($privBg, 375, 100, 785, 460)
    $g.DrawRectangle($privPen, 375, 100, 785, 460)

    $privHeaderBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(3, 105, 161))
    $g.DrawString("ZONA TERISOLASI: DOCKER OVERLAY NETWORK (wartiket-net)", $zoneHeaderFont, $privHeaderBrush, 395, 115)
    $g.DrawString("Enkapsulasi VXLAN, DNS Discovery Tertanam, Port Internal Tidak Terbuka ke Publik", $subZoneFont, $mutedText, 395, 140)

    # Inside wartiket-net:
    # 1. Nginx Box
    $g.FillRectangle($boxBg, 400, 180, 220, 340)
    $g.DrawRectangle($boxPen, 400, 180, 220, 340)
    $ngHeader = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(22, 101, 52))
    $g.DrawString("INGRESS SERVICE", $itemFont, $ngHeader, 445, 195)
    $g.DrawString("wartiket_nginx (2 Replika)", $itemFont, $darkText, 435, 215)
    $badgeOpen = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(22, 163, 74))
    $g.DrawString("PORT TERBUKA:", $itemFont, $badgeOpen, 415, 245)
    $g.DrawString("• 80:80 (HTTP Publik)", $subZoneFont, $darkText, 415, 265)
    $g.DrawString("• 443:443 (HTTPS Publik)", $subZoneFont, $darkText, 415, 285)
    $g.DrawString("FUNGSI KEAMANAN:", $itemFont, $ngHeader, 415, 320)
    $g.DrawString("• Drop paket non-HTTP", $subZoneFont, $mutedText, 415, 340)
    $g.DrawString("• Rate Limiting & Proxy", $subZoneFont, $mutedText, 415, 360)
    $g.DrawString("• Single entry point klaster", $subZoneFont, $mutedText, 415, 380)
    $g.DrawString("• Isolasi backend dari IP publik", $subZoneFont, $mutedText, 415, 400)
    $g.DrawString("• Round-Robin Load Balance", $subZoneFont, $mutedText, 415, 420)

    # 2. Node.js App Cluster Box
    $g.FillRectangle($boxBg, 650, 180, 240, 340)
    $g.DrawRectangle($boxPen, 650, 180, 240, 340)
    $appHead = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(180, 83, 9))
    $g.DrawString("APPLICATION SERVICE", $itemFont, $appHead, 695, 195)
    $g.DrawString("wartiket_app (2-8 Replika)", $itemFont, $darkText, 690, 215)
    $badgeClosed = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(220, 38, 38))
    $g.DrawString("STATUS PORT PUBLIK:", $itemFont, $badgeClosed, 665, 245)
    $g.DrawString("• TIDAK ADA (NONE / TERTUTUP)", $itemFont, $badgeClosed, 665, 265)
    $g.DrawString("• Port Internal: 3000 (Private)", $subZoneFont, $darkText, 665, 285)
    $g.DrawString("FUNGSI KEAMANAN:", $itemFont, $appHead, 665, 320)
    $g.DrawString("• Hanya diakses via Nginx Ingress", $subZoneFont, $mutedText, 665, 340)
    $g.DrawString("• Tidak dapat di-ping dari luar", $subZoneFont, $mutedText, 665, 360)
    $g.DrawString("• Embedded DNS discovery", $subZoneFont, $mutedText, 665, 380)
    $g.DrawString("• Skalasi aman hingga 8 replika", $subZoneFont, $mutedText, 665, 400)
    $g.DrawString("• Healthcheck periodik 10s", $subZoneFont, $mutedText, 665, 420)

    # 3. Redis Box
    $g.FillRectangle($boxBg, 920, 180, 220, 340)
    $g.DrawRectangle($boxPen, 920, 180, 220, 340)
    $redHead = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(153, 27, 27))
    $g.DrawString("DATABASE & CACHE SERVICE", $itemFont, $redHead, 935, 195)
    $g.DrawString("wartiket_redis (1 Replika)", $itemFont, $darkText, 955, 215)
    $g.DrawString("STATUS PORT PUBLIK:", $itemFont, $badgeClosed, 935, 245)
    $g.DrawString("• TIDAK ADA (NONE / TERTUTUP)", $itemFont, $badgeClosed, 935, 265)
    $g.DrawString("• Port Internal: 6379 (Private)", $subZoneFont, $darkText, 935, 285)
    $g.DrawString("FUNGSI KEAMANAN:", $itemFont, $redHead, 935, 320)
    $g.DrawString("• Isolasi absolut dari publik", $subZoneFont, $mutedText, 935, 340)
    $g.DrawString("• Kebal serangan brute-force luar", $subZoneFont, $mutedText, 935, 360)
    $g.DrawString("• Hanya diakses oleh wartiket_app", $subZoneFont, $mutedText, 935, 380)
    $g.DrawString("• Disk persistence (AOF storage)", $subZoneFont, $mutedText, 935, 400)
    $g.DrawString("• Atomic DECR Quota Protection", $subZoneFont, $mutedText, 935, 420)

    # Connections between boxes
    $connPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(2, 132, 199), 2)
    $connPen.CustomEndCap = New-Object System.Drawing.Drawing2D.AdjustableArrowCap(5, 5)
    $g.DrawLine($connPen, 620, 300, 650, 300)
    $g.DrawLine($connPen, 890, 300, 920, 300)

    # Traffic arrow from Internet to Nginx
    $extPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(220, 38, 38), 3)
    $extPen.CustomEndCap = New-Object System.Drawing.Drawing2D.AdjustableArrowCap(6, 6)
    $g.DrawLine($extPen, 280, 260, 400, 260)

    $bmp.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
    Write-Output "Network Topology Diagram successfully generated: $outputPath"
}

Draw-ArchitectureDiagram -outputPath "$PSScriptRoot\diagram_arsitektur_sistem.png"
Draw-NetworkTopologyDiagram -outputPath "$PSScriptRoot\diagram_topologi_jaringan.png"
