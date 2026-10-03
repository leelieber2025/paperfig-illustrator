// PaperFig for Illustrator 0.8.2. Executed with Fiji --ij2 --headless --run.
// Inbox directory comes from the PAPERFIG_INBOX environment variable (set by raw-bridge.js).
import groovy.json.JsonSlurper
import groovy.json.JsonOutput
import loci.formats.ImageReader
import loci.formats.ChannelSeparator
import loci.formats.FormatTools
import loci.common.services.ServiceFactory
import loci.formats.services.OMEXMLService
import ome.units.UNITS


def inboxPath = System.getenv('PAPERFIG_INBOX')
if (!inboxPath) throw new IllegalStateException('PAPERFIG_INBOX is not set')
def inboxDir = new File(inboxPath)

def processRequest = { File requestFile ->
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
} catch(Throwable e) {
    def msg = (e instanceof OutOfMemoryError) ? 'Out of memory reading this dataset. Increase Fiji memory (Edit > Options > Memory) or export a smaller OME-TIFF. ('+e+')' : e.toString()
    output.text=JsonOutput.toJson([ok:false,error:msg]);throw e
} finally {reader.close()}

}

new File(inboxDir,'ready').text='SCI_BITMAP_ENGINE_READY'
long lastJob=System.currentTimeMillis()
while(!new File(inboxDir,'shutdown').exists() && System.currentTimeMillis()-lastJob<600000L) {
    def requests=inboxDir.listFiles().findAll { it.name.endsWith('.request.json') }.sort { it.name }
    requests.each { File req ->
        def result=[ok:true]
        try { processRequest(req) } catch(Throwable e) {result=[ok:false,error:(e instanceof OutOfMemoryError)?'Out of memory reading this dataset. Increase Fiji memory or export a smaller OME-TIFF.':e.toString()]}
        File response=new File(inboxDir,req.name.replace('.request.json','.response.json'))
        File partial=new File(response.absolutePath+'.partial');partial.text=JsonOutput.toJson(result)
        java.nio.file.Files.move(partial.toPath(),response.toPath(),java.nio.file.StandardCopyOption.REPLACE_EXISTING)
        req.delete();lastJob=System.currentTimeMillis()
    }
    Thread.sleep(100)
}
// Tell the panel not to submit more work here; any request that raced in is retried by raw-bridge.js.
new File(inboxDir,'stopping').text='1'
println('SCI_BITMAP_SERVICE_STOPPED')
