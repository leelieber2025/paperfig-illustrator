// PaperFig for Illustrator 0.6.0. Executed with Fiji --ij2 --headless --run. requestFile is prepended by CEP.
import groovy.json.JsonSlurper
import groovy.json.JsonOutput
import loci.formats.ImageReader
import loci.formats.ChannelSeparator
import loci.formats.FormatTools
import loci.common.services.ServiceFactory
import loci.formats.services.OMEXMLService
import ome.units.UNITS

def req = new JsonSlurper().parse(requestFile)
def output = new File(req.output.toString())
def reader = new ChannelSeparator(new ImageReader())
try {
    def store = new ServiceFactory().getInstance(OMEXMLService.class).createOMEXMLMetadata()
    reader.setMetadataStore(store)
    reader.setId(req.source.toString())
    if(reader.getUsedFiles().toList().unique().size()>1) throw new IllegalArgumentException("Multi-file datasets need a single-file OME-TIFF export first")
    int series = req.series as int
    if (series < 0 || series >= reader.getSeriesCount()) throw new IllegalArgumentException('Series index outside dataset')
    reader.setSeries(series)
    int type = reader.getPixelType()
    if (type != FormatTools.UINT8 && type != FormatTools.UINT16) throw new IllegalArgumentException('Only unsigned 8/16-bit source pixels are supported')
    if (reader.isIndexed()) throw new IllegalArgumentException('Indexed color is not a raw intensity channel')
    int w=reader.getSizeX(), h=reader.getSizeY(), nc=reader.getSizeC(), z=req.z as int, t=req.t as int
    if (z<0 || z>=reader.getSizeZ() || t<0 || t>=reader.getSizeT()) throw new IllegalArgumentException('Z/T index outside dataset')
    if (nc<1 || nc>8 || (long)w*h>64000000L || (long)w*h*nc>128000000L) throw new IllegalArgumentException('Dataset exceeds 8-channel / memory limit')
    int bits=FormatTools.getBytesPerPixel(type)*8
    def names=[], files=[]
    for(int c=0;c<nc;c++) {
        String name=null
        try { name=store.getChannelName(series,c) } catch(Exception ignored) {}
        names.add(name ?: 'C'+(c+1))
        byte[] bytes=reader.openBytes(reader.getIndex(z,c,t))
        if(bytes.length != (long)w*h*(bits/8)) throw new IllegalArgumentException('Unexpected plane layout')
        if(bits==16 && !reader.isLittleEndian()) for(int p=0;p<bytes.length;p+=2) { byte v=bytes[p];bytes[p]=bytes[p+1];bytes[p+1]=v }
        File f=new File(output.parentFile,'channel-'+c+'.raw');f.bytes=bytes;files.add(f.absolutePath)
    }
    def x=null,y=null
    try { x=store.getPixelsPhysicalSizeX(series)?.value(UNITS.MICROMETER)?.doubleValue() } catch(Exception ignored) {}
    try { y=store.getPixelsPhysicalSizeY(series)?.value(UNITS.MICROMETER)?.doubleValue() } catch(Exception ignored) {}
    output.text=JsonOutput.toJson([ok:true,width:w,height:h,bits:bits,names:names,files:files,physical:[x:x,y:y],sizeZ:reader.getSizeZ(),sizeT:reader.getSizeT(),seriesCount:reader.getSeriesCount(),series:series,z:z,t:t,reader:'Bio-Formats '+loci.formats.FormatTools.VERSION])
    println('SCI_BITMAP_RAW_OK')
} catch(Exception e) {
    output.text=JsonOutput.toJson([ok:false,error:e.toString()]);throw e
} finally {reader.close()}
