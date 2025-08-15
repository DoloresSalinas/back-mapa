# Usa una imagen base de Node.js
FROM node:18-alpine

# Establece el directorio de trabajo dentro del contenedor
WORKDIR /usr/src/app

# Copia los archivos de manifiesto del proyecto (para aprovechar la caché de Docker)
COPY package*.json ./

# Instala las dependencias
RUN npm install

# Copia el resto del código de la aplicación
COPY . .

# Expón el puerto que usa tu aplicación
EXPOSE 3000

# Comando para iniciar tu aplicación
CMD [ "node", "index.js" ]