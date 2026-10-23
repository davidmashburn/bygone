import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.reflect.TypeToken;
import gr.uom.java.xmi.LocationInfo;
import gr.uom.java.xmi.VariableDeclarationContainer;
import gr.uom.java.xmi.decomposition.AbstractCodeFragment;
import gr.uom.java.xmi.decomposition.UMLOperationBodyMapper;
import gr.uom.java.xmi.diff.*;
import org.refactoringminer.api.Refactoring;
import org.refactoringminer.astDiff.models.ProjectASTDiff;
import org.refactoringminer.rm1.GitHistoryRefactoringMinerImpl;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

/** Research API bridge compiled against the pinned external jar. No upstream code is copied. */
public final class BygoneMappingsBridge {
    private final Map<String, String> before;
    private final Map<String, String> after;
    private final int maxRecords;
    private int records;
    private boolean truncated;
    private final Map<UMLOperationBodyMapper, Set<String>> origins = new IdentityHashMap<>();
    private final List<UMLOperationBodyMapper> ordered = new ArrayList<>();

    private BygoneMappingsBridge(Map<String, String> before, Map<String, String> after, int maxRecords) {
        this.before = before;
        this.after = after;
        this.maxRecords = maxRecords;
    }

    private boolean consume() {
        if (records >= maxRecords) { truncated = true; return false; }
        records++;
        return true;
    }

    private void collect(UMLOperationBodyMapper mapper, String origin) {
        if (mapper == null) return;
        Set<String> known = origins.get(mapper);
        if (known != null) { known.add(origin); return; }
        if (!consume()) return;
        origins.put(mapper, new LinkedHashSet<>(List.of(origin)));
        ordered.add(mapper);
        for (UMLOperationBodyMapper child : mapper.getChildMappers()) collect(child, "nested");
        for (UMLOperationBodyMapper lambda : mapper.getLambdaMappers()) collect(lambda, "nested");
    }

    private Map<String, Object> range(LocationInfo location, boolean old) throws Exception {
        Map<String, Object> out = new LinkedHashMap<>();
        String path = location.getFilePath();
        int start = location.getStartOffset(), end = location.getEndOffset();
        String content = (old ? before : after).get(path);
        boolean valid = content != null && start >= 0 && end >= start && end <= content.length();
        out.put("path", path); out.put("start", start); out.put("end", end);
        out.put("elementType", location.getCodeElementType().name());
        out.put("valid", valid);
        if (valid) {
            String text = content.substring(start, end);
            out.put("text", text);
            out.put("sha256", HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8))));
        }
        return out;
    }

    private Map<String, Object> container(VariableDeclarationContainer container, boolean old) throws Exception {
        Map<String, Object> out = range(container.getLocationInfo(), old);
        out.put("name", container.getName());
        out.put("owner", container.getClassName());
        return out;
    }

    private List<Object> fragments(List<? extends AbstractCodeFragment> fragments, boolean old) throws Exception {
        List<Object> out = new ArrayList<>();
        for (AbstractCodeFragment fragment : fragments) {
            if (!consume()) break;
            out.add(range(fragment.getLocationInfo(), old));
        }
        return out;
    }

    private Map<String, Object> export(ProjectASTDiff diff) throws Exception {
        // Explicit refactoring mappers supply extraction/inline roles. Ordinary
        // class-diff mappers include unchanged and edited method continuations
        // underneath moved/renamed modules, absent from the event list.
        for (Refactoring ref : diff.getRefactorings()) {
            if (ref instanceof ExtractOperationRefactoring r) collect(r.getBodyMapper(), "extract");
            else if (ref instanceof InlineOperationRefactoring r) collect(r.getBodyMapper(), "inline");
            else if (ref instanceof MoveOperationRefactoring r) collect(r.getBodyMapper(), "continuation");
            else if (ref instanceof RenameOperationRefactoring r) collect(r.getBodyMapper(), "continuation");
        }
        UMLModelDiff model = diff.getModelDiff();
        List<UMLClassBaseDiff> classes = new ArrayList<>();
        classes.addAll(model.getCommonClassDiffList());
        classes.addAll(model.getClassMoveDiffList());
        classes.addAll(model.getInnerClassMoveDiffList());
        classes.addAll(model.getClassRenameDiffList());
        for (UMLClassBaseDiff cls : classes) {
            for (UMLOperationBodyMapper mapper : cls.getOperationBodyMapperList()) collect(mapper, "continuation");
        }
        List<Object> classMappings = new ArrayList<>();
        for (UMLClassBaseDiff cls : classes) {
            if (!consume()) break;
            Map<String, Object> source = range(cls.getOriginalClass().getLocationInfo(), true);
            Map<String, Object> destination = range(cls.getNextClass().getLocationInfo(), false);
            source.put("name", cls.getOriginalClassName());
            destination.put("name", cls.getNextClassName());
            classMappings.add(Map.of("id", "class-" + classMappings.size(), "source", source, "destination", destination));
        }
        List<Object> mappers = new ArrayList<>();
        for (UMLOperationBodyMapper mapper : ordered) {
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("id", "mapper-" + mappers.size());
            out.put("origins", origins.get(mapper));
            out.put("source", container(mapper.getContainer1(), true));
            out.put("destination", container(mapper.getContainer2(), false));
            List<Object> mappings = new ArrayList<>();
            for (var mapping : mapper.getMappings()) {
                if (!consume()) break;
                mappings.add(Map.of("source", range(mapping.getFragment1().getLocationInfo(), true),
                        "destination", range(mapping.getFragment2().getLocationInfo(), false),
                        "engineExact", mapping.isExact()));
            }
            out.put("mappings", mappings);
            out.put("unmappedBefore", fragments(mapper.getNonMappedLeavesT1(), true));
            out.put("unmappedAfter", fragments(mapper.getNonMappedLeavesT2(), false));
            out.put("unmappedInnerBefore", fragments(mapper.getNonMappedInnerNodesT1(), true));
            out.put("unmappedInnerAfter", fragments(mapper.getNonMappedInnerNodesT2(), false));
            mappers.add(out);
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("version", 1);
        result.put("coordinateUnit", "UTF-16; zero-based; half-open");
        result.put("status", truncated ? "partial" : "complete");
        result.put("truncated", truncated);
        result.put("records", records);
        result.put("mappers", mappers);
        result.put("classMappings", classMappings);
        result.put("processedPaths", Map.of("before", diff.getFileContentsBefore().keySet(), "after", diff.getFileContentsAfter().keySet()));
        return result;
    }

    public static void main(String[] args) {
        Gson gson = new Gson();
        try {
            byte[] bytes = System.in.readNBytes(8 * 1024 * 1024 + 1);
            if (bytes.length > 8 * 1024 * 1024) throw new IllegalArgumentException("input-byte-budget");
            JsonObject input = gson.fromJson(new String(bytes, StandardCharsets.UTF_8), JsonObject.class);
            java.lang.reflect.Type type = new TypeToken<LinkedHashMap<String, String>>() {}.getType();
            Map<String, String> before = gson.fromJson(input.get("before"), type);
            Map<String, String> after = gson.fromJson(input.get("after"), type);
            int limit = input.has("maxRecords") ? input.get("maxRecords").getAsInt() : 20000;
            if (limit < 1 || limit > 100000) throw new IllegalArgumentException("invalid-record-budget");
            BygoneMappingsBridge bridge = new BygoneMappingsBridge(before, after, limit);
            ProjectASTDiff diff = new GitHistoryRefactoringMinerImpl().diffAtFileContents(new LinkedHashMap<>(before), new LinkedHashMap<>(after));
            System.out.println(gson.toJson(bridge.export(diff)));
        } catch (Exception e) {
            System.out.println(gson.toJson(Map.of("version", 1, "status", "unavailable", "reason", e.getClass().getSimpleName() + ": " + String.valueOf(e.getMessage()), "mappers", List.of())));
        }
    }
}
