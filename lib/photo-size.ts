/** The size of the picture inside a stored data: URL. The base64 text the database holds is a third bigger than the picture. */
export const pictureBytes = (dataUrl: string) => Math.round(dataUrl.length * 3 / 4);
