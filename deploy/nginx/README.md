# BinGO 教师端公网入口

阿里云服务器已经通过 FRP 暴露 Windows 主机的教师网页端到本机 `15204`。在阿里云 Nginx 上新增站点后，再由 Certbot 为该域名签发证书。

```bash
sudo cp teacher.bingo.mido.site.conf /etc/nginx/sites-available/teacher.bingo.mido.site.conf
sudo ln -s /etc/nginx/sites-available/teacher.bingo.mido.site.conf /etc/nginx/sites-enabled/teacher.bingo.mido.site.conf
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d teacher.bingo.mido.site
```

执行前确认 DNS 中 `teacher.bingo.mido.site` 的 A 记录指向阿里云服务器，且 `15204` 仅绑定在阿里云本机回环接口上；不要把 Windows 主机端口直接暴露到公网。
